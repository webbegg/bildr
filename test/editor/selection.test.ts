import { describe, expect, it } from 'vitest'
import { createNode, createPage } from '#shared/document/factory'
import { breadcrumb, escapeSelection, nearestUnlocked, sameComponentNodes, sameTypeNodes, selectionAfterDelete } from '#shared/editor/selection'
import { isCanvasMessage } from '#shared/editor/protocol'

describe('selectionAfterDelete', () => {
  const page = createPage('Home')
  const row = createNode('Row')
  const [a, b, c] = [createNode('Text'), createNode('Text'), createNode('Text')]
  row.children.push(a, b, c)
  page.root.children.push(row)

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

describe('breadcrumb', () => {
  const page = createPage('Home')
  const card = createNode('Card')
  const text = createNode('Text')
  card.children.push(text)
  page.root.children.push(card)

  it('lists the ancestors of a node from the page root down, without the node', () => {
    expect(breadcrumb(page.root, text.id)).toEqual([
      { id: page.root.id, type: 'Page' },
      { id: card.id, type: 'Card' }
    ])
    expect(breadcrumb(page.root, card.id)).toEqual([{ id: page.root.id, type: 'Page' }])
  })

  it('is empty for the root or a missing node', () => {
    expect(breadcrumb(page.root, page.root.id)).toEqual([])
    expect(breadcrumb(page.root, 'missing')).toEqual([])
  })
})

describe('isCanvasMessage', () => {
  it('accepts bildr messages and ignores everything else', () => {
    expect(isCanvasMessage({ type: 'bildr:click', nodeId: 'n_1' })).toBe(true)
    expect(isCanvasMessage({ type: 'webpackOk' })).toBe(false)
    expect(isCanvasMessage('bildr:click')).toBe(false)
    expect(isCanvasMessage(null)).toBe(false)
  })
})

describe('nearestUnlocked', () => {
  const page = createPage('Home')
  const card = createNode('Card')
  const inner = createNode('Column')
  const text = createNode('Text')
  inner.children.push(text)
  card.children.push(inner)
  page.root.children.push(card)

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
  card.children.push(text)
  page.root.children.push(card)

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
  card.children.push(b, i3)
  page.root.children.push(a, card, button, i1, i2)

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
