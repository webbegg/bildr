import { describe, expect, it } from 'vitest'
import { createNode, createPage } from '#shared/document/factory'
import { dropPosition, insertTargetForSelection, moveTarget, resolveDrop } from '#shared/editor/dropTarget'

function fixture() {
  const page = createPage('Home')
  const card = createNode('Card')
  const [a, b] = [createNode('Text'), createNode('Text')]
  card.children.push(a, b)
  const heading = createNode('Heading')
  page.root.children.push(heading, card)
  return { root: page.root, card, a, b, heading }
}

describe('dropPosition', () => {
  const rect = { top: 100, left: 0, width: 200, height: 100 }

  it('splits leaves in halves along the axis', () => {
    expect(dropPosition(rect, { x: 10, y: 120 }, { container: false, horizontal: false })).toBe('before')
    expect(dropPosition(rect, { x: 10, y: 180 }, { container: false, horizontal: false })).toBe('after')
    expect(dropPosition(rect, { x: 150, y: 120 }, { container: false, horizontal: true })).toBe('after')
  })

  it('uses the middle of a container for inside', () => {
    expect(dropPosition(rect, { x: 10, y: 110 }, { container: true, horizontal: false })).toBe('before')
    expect(dropPosition(rect, { x: 10, y: 150 }, { container: true, horizontal: false })).toBe('inside')
    expect(dropPosition(rect, { x: 10, y: 195 }, { container: true, horizontal: false })).toBe('after')
  })
})

describe('resolveDrop', () => {
  it('drops before or after a node in its parent', () => {
    const { root, card, b } = fixture()
    expect(resolveDrop(root, b.id, 'before')).toEqual({ parentId: card.id, index: 1 })
    expect(resolveDrop(root, b.id, 'after')).toEqual({ parentId: card.id, index: 2 })
  })

  it('drops inside a container at the end, and anything on the root goes inside it', () => {
    const { root, card } = fixture()
    expect(resolveDrop(root, card.id, 'inside')).toEqual({ parentId: card.id, index: 2 })
    expect(resolveDrop(root, root.id, 'before')).toEqual({ parentId: root.id, index: 2 })
  })

  it('refuses to drop a node into itself or its descendants', () => {
    const { root, card, a } = fixture()
    expect(resolveDrop(root, a.id, 'after', card.id)).toBeNull()
    expect(resolveDrop(root, card.id, 'inside', card.id)).toBeNull()
  })
})

describe('moveTarget', () => {
  it('compensates for the node leaving its own parent', () => {
    const { root, heading, card } = fixture()
    // Dropping the heading after the card: slot 2 becomes index 1 once it leaves.
    expect(moveTarget(root, heading.id, { parentId: root.id, index: 2 })).toEqual({ parentId: root.id, index: 1 })
    expect(moveTarget(root, card.id, { parentId: root.id, index: 0 })).toEqual({ parentId: root.id, index: 0 })
  })
})

describe('insertTargetForSelection', () => {
  it('inserts into a selected container, after a selected leaf, or at the page end', () => {
    const { root, card, a } = fixture()
    expect(insertTargetForSelection(root, card.id)).toEqual({ parentId: card.id, index: 2 })
    expect(insertTargetForSelection(root, a.id)).toEqual({ parentId: card.id, index: 1 })
    expect(insertTargetForSelection(root, null)).toEqual({ parentId: root.id, index: 2 })
  })
})
