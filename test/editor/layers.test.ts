import { describe, expect, it } from 'vitest'
import { createNode, createPage } from '#shared/document/factory'
import { collapsedAncestors, hiddenBadge, layerKeyAction, naturalDisplay, siblingMove, siblingMoves, visibilityAt, visibilityToggle, visibleLayers } from '#shared/editor/layers'

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

describe('visibilityAt', () => {
  it('resolves the display token mobile-first and says which breakpoint it comes from', () => {
    expect(visibilityAt({}, 'tablet')).toEqual({ hidden: false, source: undefined })
    expect(visibilityAt({ display: 'hidden' }, 'mobile')).toEqual({ hidden: true, source: undefined, value: 'hidden' })
    expect(visibilityAt({ display: 'hidden' }, 'desktop')).toEqual({ hidden: true, source: undefined, value: 'hidden' })
    expect(visibilityAt({ 'display': 'hidden', 'md:display': 'flex' }, 'desktop')).toEqual({ hidden: false, source: 'md', value: 'flex' })
    expect(visibilityAt({ 'lg:display': 'hidden' }, 'tablet')).toEqual({ hidden: false, source: undefined })
    expect(visibilityAt({ 'sm:display': 'hidden' }, 'tablet')).toEqual({ hidden: true, source: 'sm', value: 'hidden' })
  })

  it('badges a row hidden only at other breakpoints', () => {
    const style = { 'display': 'hidden', 'md:display': 'block', 'lg:display': 'hidden' }
    expect(hiddenBadge(style, 'tablet')).toBe('base lg')
    expect(hiddenBadge(style, 'mobile')).toBeNull()
    expect(hiddenBadge({ 'md:display': 'hidden', 'lg:display': 'flex' }, 'desktop')).toBe('md')
    expect(hiddenBadge({}, 'mobile')).toBeNull()
  })
})

describe('naturalDisplay', () => {
  it('is the display a node renders with when no display token applies', () => {
    expect(naturalDisplay({ type: 'Row', props: {} })).toBe('flex')
    expect(naturalDisplay({ type: 'Column', props: {} })).toBe('flex')
    expect(naturalDisplay({ type: 'Button', props: {} })).toBe('flex')
    expect(naturalDisplay({ type: 'Grid', props: {} })).toBe('grid')
    expect(naturalDisplay({ type: 'List', props: { layout: 'grid' } })).toBe('grid')
    expect(naturalDisplay({ type: 'List', props: {} })).toBe('flex')
    expect(naturalDisplay({ type: 'Text', props: {} })).toBe('block')
    expect(naturalDisplay({ type: 'Card', props: {} })).toBe('block')
  })
})

describe('visibilityToggle', () => {
  it('hides at the device breakpoint only, keeping wider devices as they were', () => {
    expect(visibilityToggle({}, 'mobile', 'block')).toEqual({ 'display': 'hidden', 'md:display': 'block' })
    expect(visibilityToggle({}, 'tablet', 'flex')).toEqual({ 'md:display': 'hidden', 'lg:display': 'flex' })
    expect(visibilityToggle({}, 'desktop', 'flex')).toEqual({ 'lg:display': 'hidden' })
    expect(visibilityToggle({ display: 'grid' }, 'mobile', 'grid')).toEqual({ 'display': 'hidden', 'md:display': 'grid' })
    expect(visibilityToggle({ 'md:display': 'grid' }, 'mobile', 'flex')).toEqual({ display: 'hidden' })
  })

  it('shows again by removing the hide, undoing the override it wrote above', () => {
    expect(visibilityToggle({ 'display': 'hidden', 'md:display': 'block' }, 'mobile', 'block')).toEqual({ 'display': null, 'md:display': null })
    expect(visibilityToggle({ 'md:display': 'hidden', 'lg:display': 'flex' }, 'tablet', 'flex')).toEqual({ 'md:display': null, 'lg:display': null })
    expect(visibilityToggle({ 'lg:display': 'hidden' }, 'desktop', 'flex')).toEqual({ 'lg:display': null })
  })

  it('shows a node hidden from a smaller breakpoint with its natural display', () => {
    expect(visibilityToggle({ 'md:display': 'hidden' }, 'desktop', 'flex')).toEqual({ 'lg:display': 'flex' })
    expect(visibilityToggle({ display: 'hidden' }, 'tablet', 'block')).toEqual({ 'md:display': 'block', 'lg:display': 'hidden' })
  })
})

describe('siblingMoves', () => {
  /** Page > [x, y, z, w, v] as Texts. */
  function row() {
    const page = createPage('Home')
    const nodes = ['x', 'y', 'z', 'w', 'v'].map(() => createNode('Text'))
    page.root.children.push(...nodes)
    return { root: page.root, ids: nodes.map(n => n.id) }
  }

  it('moves each selected node one step, in an order where each move keeps its index meaning', () => {
    const { root, ids: [x, y, z, w] } = row()
    expect(siblingMoves(root, [w!, y!], -1)).toEqual([
      { nodeId: y, parentId: root.id, index: 0 },
      { nodeId: w, parentId: root.id, index: 2 }
    ])
    expect(siblingMoves(root, [x!, z!], 1)).toEqual([
      { nodeId: z, parentId: root.id, index: 3 },
      { nodeId: x, parentId: root.id, index: 1 }
    ])
  })

  it('refuses the whole move when one node is at the end of its siblings', () => {
    const { root, ids: [x, y, , , v] } = row()
    expect(siblingMoves(root, [y!, x!], -1)).toBeNull()
    expect(siblingMoves(root, [v!], 1)).toBeNull()
    expect(siblingMoves(root, [root.id], 1)).toBeNull()
  })
})
