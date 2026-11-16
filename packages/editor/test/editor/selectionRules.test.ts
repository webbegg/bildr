import { describe, expect, it } from 'vitest'
import type { ModelNode } from '@bildr/codegen/model'
import { canvasMovable, drillTarget, escapeSelection, navigateSelection, nearestUnlocked, sameComponentNodes, sameTypeNodes, selectAllSiblings, selectionAfterDelete, siblingParent, toggleSelection, topLevelSelection } from '../../src/editor/selection.ts'

/** Ported from the hosted `multiSelect`, `selection` and `canvasLock` tests: the selection rules over a `ModelNode` tree. */

let counter = 0
const createNode = (type: string, props: ModelNode['props'] = {}): ModelNode => ({ id: `n_${++counter}`, type, props, children: [] })
const createPage = (name: string) => ({ name, root: createNode('Page') })

/** Page > [hero: Card > [title: Heading, row: Row > [a: Button, b: Button]], footer: Text]. */
function fixture() {
  const page = createPage('Home')
  const hero = createNode('Card')
  const title = createNode('Heading')
  const row = createNode('Row')
  const [a, b] = [createNode('Button'), createNode('Button')]
  const footer = createNode('Text')
  row.children!.push(a, b)
  hero.children!.push(title, row)
  page.root.children!.push(hero, footer)
  return { root: page.root, hero, title, row, a, b, footer }
}

describe('drillTarget', () => {
  it('selects the clicked element itself in deep mode', () => {
    const { root, a } = fixture()
    expect(drillTarget(root, [], a.id, { deep: true })).toBe(a.id)
  })

  it('selects the top-level child of the page root on a first click', () => {
    const { root, hero, a, footer } = fixture()
    expect(drillTarget(root, [], a.id, { deep: false })).toBe(hero.id)
    expect(drillTarget(root, [], footer.id, { deep: false })).toBe(footer.id)
    expect(drillTarget(root, [], root.id, { deep: false })).toBe(root.id)
  })

  it('selects the direct child toward the clicked element when an ancestor is selected (double-click drills)', () => {
    const { root, hero, row, a } = fixture()
    expect(drillTarget(root, [hero.id], a.id, { deep: false })).toBe(row.id)
    expect(drillTarget(root, [row.id], a.id, { deep: false })).toBe(a.id)
    expect(drillTarget(root, [a.id], a.id, { deep: false })).toBe(a.id)
  })

  it('keeps the drill level: a click inside a sibling of the selection selects at that depth', () => {
    const { root, title, row, a } = fixture()
    expect(drillTarget(root, [title.id], a.id, { deep: false })).toBe(row.id)
    expect(drillTarget(root, [a.id], row.id, { deep: false })).toBe(row.id)
  })

  it('returns null for an unknown node', () => {
    expect(drillTarget(fixture().root, [], 'missing', { deep: false })).toBeNull()
  })
})

describe('toggleSelection', () => {
  it('adds a node at the end (the new primary) or removes it', () => {
    expect(toggleSelection(['a', 'b'], 'c')).toEqual(['a', 'b', 'c'])
    expect(toggleSelection(['a', 'b', 'c'], 'b')).toEqual(['a', 'c'])
    expect(toggleSelection([], 'a')).toEqual(['a'])
  })
})

describe('selectAllSiblings', () => {
  it('selects every child of the primary selection parent', () => {
    const { root, row, a, b } = fixture()
    expect(selectAllSiblings(root, [a.id])).toEqual([a.id, b.id])
    expect(selectAllSiblings(root, [row.id, b.id])).toEqual([a.id, b.id])
  })

  it('selects the page root children with nothing or the root selected', () => {
    const { root, hero, footer } = fixture()
    expect(selectAllSiblings(root, [])).toEqual([hero.id, footer.id])
    expect(selectAllSiblings(root, [root.id])).toEqual([hero.id, footer.id])
  })
})

describe('navigateSelection', () => {
  it('goes to the first child and to the parent', () => {
    const { root, hero, title, row } = fixture()
    expect(navigateSelection(root, hero.id, 'child')).toBe(title.id)
    expect(navigateSelection(root, title.id, 'child')).toBeNull()
    expect(navigateSelection(root, row.id, 'parent')).toBe(hero.id)
    expect(navigateSelection(root, root.id, 'parent')).toBeNull()
  })

  it('steps through siblings, wrapping around', () => {
    const { root, title, row, hero, footer } = fixture()
    expect(navigateSelection(root, title.id, 'next')).toBe(row.id)
    expect(navigateSelection(root, row.id, 'next')).toBe(title.id)
    expect(navigateSelection(root, hero.id, 'prev')).toBe(footer.id)
    expect(navigateSelection(root, root.id, 'next')).toBeNull()
  })
})

describe('topLevelSelection', () => {
  it('drops the root, unknown ids, duplicates and nodes inside another selected node', () => {
    const { root, hero, a, footer } = fixture()
    expect(topLevelSelection(root, [a.id, hero.id, root.id, 'missing', footer.id, footer.id])).toEqual([hero.id, footer.id])
  })
})

describe('siblingParent', () => {
  it('is the shared parent of sibling nodes, else undefined', () => {
    const { root, row, a, b, title } = fixture()
    expect(siblingParent(root, [a.id, b.id])?.id).toBe(row.id)
    expect(siblingParent(root, [a.id, title.id])).toBeUndefined()
    expect(siblingParent(root, [root.id])).toBeUndefined()
    expect(siblingParent(root, [])).toBeUndefined()
  })
})

describe('selectionAfterDelete', () => {
  const page = createPage('Home')
  const row = createNode('Row')
  const [a, b, c] = [createNode('Text'), createNode('Text'), createNode('Text')]
  row.children!.push(a, b, c)
  page.root.children!.push(row)

  it('prefers the next sibling, then the previous one, then the parent', () => {
    expect(selectionAfterDelete(page.root, b.id)).toBe(c.id)
    expect(selectionAfterDelete(page.root, c.id)).toBe(b.id)
    expect(selectionAfterDelete(page.root, row.id)).toBe(page.root.id)
  })

  it('returns null for the root or a missing node', () => {
    expect(selectionAfterDelete(page.root, page.root.id)).toBeNull()
    expect(selectionAfterDelete(page.root, 'missing')).toBeNull()
  })
})

describe('nearestUnlocked', () => {
  const page = createPage('Home')
  const card = createNode('Card')
  const inner = createNode('Column')
  const text = createNode('Text')
  inner.children!.push(text)
  card.children!.push(inner)
  page.root.children!.push(card)

  it('is the node itself when nothing above it is locked', () => {
    expect(nearestUnlocked(page.root, text.id)).toBe(text.id)
  })

  it('climbs to the nearest ancestor above every lock', () => {
    inner.locked = true
    expect(nearestUnlocked(page.root, text.id)).toBe(card.id)
    expect(nearestUnlocked(page.root, inner.id)).toBe(card.id)
    card.locked = true
    expect(nearestUnlocked(page.root, text.id)).toBe(page.root.id)
    delete inner.locked
    delete card.locked
  })

  it('is null for a locked root or a missing node', () => {
    page.root.locked = true
    expect(nearestUnlocked(page.root, text.id)).toBeNull()
    delete page.root.locked
    expect(nearestUnlocked(page.root, 'missing')).toBeNull()
  })
})

describe('escapeSelection', () => {
  const page = createPage('Home')
  const card = createNode('Card')
  const text = createNode('Text')
  card.children!.push(text)
  page.root.children!.push(card)

  it('selects the primary selection\'s parent', () => {
    expect(escapeSelection(page.root, [text.id])).toEqual([card.id])
    expect(escapeSelection(page.root, [card.id, text.id])).toEqual([card.id])
    expect(escapeSelection(page.root, [card.id])).toEqual([page.root.id])
  })

  it('clears on the root, a missing node or nothing selected', () => {
    expect(escapeSelection(page.root, [page.root.id])).toEqual([])
    expect(escapeSelection(page.root, ['missing'])).toEqual([])
    expect(escapeSelection(page.root, [])).toEqual([])
  })
})

describe('sameTypeNodes and sameComponentNodes', () => {
  const page = createPage('Home')
  const card = createNode('Card')
  const [a, b] = [createNode('Text'), createNode('Text')]
  const button = createNode('Button')
  const [i1, i2, i3] = [createNode('Instance', { component: 'c_1' }), createNode('Instance', { component: 'c_2' }), createNode('Instance', { component: 'c_1' })]
  card.children!.push(b, i3)
  page.root.children!.push(a, card, button, i1, i2)

  it('selects every node of the same type, in document order', () => {
    expect(sameTypeNodes(page.root, b.id)).toEqual([a.id, b.id])
    expect(sameTypeNodes(page.root, button.id)).toEqual([button.id])
    expect(sameTypeNodes(page.root, 'missing')).toEqual([])
  })

  it('selects the instances of the same component, and nothing for other nodes', () => {
    expect(sameComponentNodes(page.root, i1.id)).toEqual([i3.id, i1.id])
    expect(sameComponentNodes(page.root, i2.id)).toEqual([i2.id])
    expect(sameComponentNodes(page.root, a.id)).toEqual([])
  })
})

function lockFixture() {
  const page = createPage('Home')
  const card = createNode('Card')
  const inner = createNode('Text')
  card.children!.push(inner)
  const [a, b] = [createNode('Text'), createNode('Text')]
  page.root.children!.push(card, a, b)
  return { root: page.root, card, inner, a, b }
}

describe('canvasMovable (RELIABILITY-007)', () => {
  it('keeps the unlocked top-level selection', () => {
    const { root, card, inner, a } = lockFixture()
    expect(canvasMovable(root, [card.id, inner.id, a.id])).toEqual([card.id, a.id])
  })

  it('leaves out locked nodes and nodes inside a lock', () => {
    const { root, card, inner, a, b } = lockFixture()
    a.locked = true
    expect(canvasMovable(root, [a.id, b.id])).toEqual([b.id])
    card.locked = true
    expect(canvasMovable(root, [inner.id])).toEqual([])
    expect(canvasMovable(root, [card.id])).toEqual([])
  })

  it('moves nothing under a locked root, and never the root itself', () => {
    const { root, a } = lockFixture()
    expect(canvasMovable(root, [root.id])).toEqual([])
    root.locked = true
    expect(canvasMovable(root, [a.id])).toEqual([])
  })
})
