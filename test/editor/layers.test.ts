import { describe, expect, it } from 'vitest'
import { createNode, createPage } from '#shared/document/factory'
import { collapsedAncestors, layerKeyAction, siblingMove, visibleLayers } from '#shared/editor/layers'

function fixture() {
  const page = createPage('Home')
  const card = createNode('Card')
  const [a, b] = [createNode('Text'), createNode('Text')]
  card.children.push(a, b)
  const heading = createNode('Heading')
  page.root.children.push(heading, card)
  return { root: page.root, card, a, b, heading }
}

describe('visibleLayers', () => {
  it('lists the rows top to bottom, skipping the children of collapsed rows', () => {
    const { root, card, a, b, heading } = fixture()
    expect(visibleLayers(root, new Set())).toEqual([root.id, heading.id, card.id, a.id, b.id])
    expect(visibleLayers(root, new Set([card.id]))).toEqual([root.id, heading.id, card.id])
  })
})

describe('layerKeyAction', () => {
  it('moves the selection through the visible rows with ArrowUp and ArrowDown', () => {
    const { root, card, a, heading } = fixture()
    expect(layerKeyAction(root, new Set(), heading.id, 'ArrowDown')).toEqual({ select: card.id })
    expect(layerKeyAction(root, new Set(), card.id, 'ArrowDown')).toEqual({ select: a.id })
    expect(layerKeyAction(root, new Set([card.id]), card.id, 'ArrowDown')).toBeNull()
    expect(layerKeyAction(root, new Set(), heading.id, 'ArrowUp')).toEqual({ select: root.id })
    expect(layerKeyAction(root, new Set(), root.id, 'ArrowUp')).toBeNull()
    expect(layerKeyAction(root, new Set(), null, 'ArrowDown')).toEqual({ select: root.id })
  })

  it('collapses or goes to the parent with ArrowLeft, and expands with ArrowRight', () => {
    const { root, card, a } = fixture()
    expect(layerKeyAction(root, new Set(), card.id, 'ArrowLeft')).toEqual({ collapse: card.id })
    expect(layerKeyAction(root, new Set([card.id]), card.id, 'ArrowLeft')).toEqual({ select: root.id })
    expect(layerKeyAction(root, new Set(), a.id, 'ArrowLeft')).toEqual({ select: card.id })
    expect(layerKeyAction(root, new Set([card.id]), card.id, 'ArrowRight')).toEqual({ expand: card.id })
    expect(layerKeyAction(root, new Set(), card.id, 'ArrowRight')).toBeNull()
    expect(layerKeyAction(root, new Set(), a.id, 'Enter')).toBeNull()
  })
})

describe('collapsedAncestors', () => {
  it('names the collapsed rows hiding a node', () => {
    const { root, card, a } = fixture()
    expect(collapsedAncestors(root, new Set([card.id, root.id]), a.id)).toEqual([root.id, card.id])
    expect(collapsedAncestors(root, new Set([card.id]), card.id)).toEqual([])
  })
})

describe('siblingMove', () => {
  it('gives the node_move slot one step up or down among the siblings', () => {
    const { root, card, a, b, heading } = fixture()
    expect(siblingMove(root, b.id, -1)).toEqual({ parentId: card.id, index: 0 })
    expect(siblingMove(root, a.id, 1)).toEqual({ parentId: card.id, index: 1 })
    expect(siblingMove(root, heading.id, -1)).toBeNull()
    expect(siblingMove(root, b.id, 1)).toBeNull()
    expect(siblingMove(root, root.id, 1)).toBeNull()
  })
})
