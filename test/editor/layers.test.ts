import { describe, expect, it } from 'vitest'
import { createNode, createPage } from '#shared/document/factory'
import type { ComponentDefinition, DocNode, Layout, Page } from '#shared/document/schema'
import { findNode } from '#shared/document/tree'
import { collapsedAncestors, hiddenBadge, layerFrames, layerKeyAction, layerName, naturalDisplay, siblingMove, siblingMoves, visibilityAt, visibilityToggle, visibleLayers } from '#shared/editor/layers'
import { devicesFor } from '#shared/editor/styleFields'

function fixture() {
  const page = createPage('Home')
  const card = createNode('Card')
  const [a, b] = [createNode('Text'), createNode('Text')]
  card.children.push(a, b)
  const heading = createNode('Heading')
  page.root.children.push(heading, card)
  return { root: page.root, card, a, b, heading }
}

describe('layerFrames', () => {
  const [desktop, tablet] = devicesFor('desktop')
  const mobile = devicesFor('mobile')[0]!

  it('shows no frame rows for a single visible frame: the page tree is the top of the tree, on that device', () => {
    expect(layerFrames([desktop!], 'desktop')).toEqual({ rows: [], indent: 0, device: 'desktop' })
    expect(layerFrames([mobile], 'mobile')).toEqual({ rows: [], indent: 0, device: 'mobile' })
  })

  it('edits the only frame even when the edited device is another one', () => {
    expect(layerFrames([desktop!], 'tablet').device).toBe('desktop')
  })

  it('shows a root row per visible frame from two frames, with the page tree one level in under the edited one', () => {
    expect(layerFrames([desktop!, tablet!], 'tablet')).toEqual({ rows: [desktop, tablet], indent: 1, device: 'tablet' })
  })
})

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

  it('badges over the shown frames, Large phone (sm) only when shown', () => {
    const style = { 'display': 'hidden', 'md:display': 'block' }
    expect(hiddenBadge(style, 'tablet')).toBe('base')
    expect(hiddenBadge(style, 'tablet', ['desktop', 'tablet', 'large-phone', 'mobile'])).toBe('base sm')
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

  it('works over the shown frames: with Large phone shown, Mobile hands over to sm', () => {
    const shown = ['desktop', 'tablet', 'large-phone', 'mobile'] as const
    expect(visibilityToggle({}, 'mobile', 'block', shown)).toEqual({ 'display': 'hidden', 'sm:display': 'block' })
    expect(visibilityToggle({}, 'large-phone', 'flex', shown)).toEqual({ 'sm:display': 'hidden', 'md:display': 'flex' })
    expect(visibilityToggle({ 'display': 'hidden', 'sm:display': 'block' }, 'mobile', 'block', shown)).toEqual({ 'display': null, 'sm:display': null })
  })

  it('includes the edited device even when its frame is not in the shown list', () => {
    expect(visibilityToggle({}, 'large-phone', 'flex')).toEqual({ 'sm:display': 'hidden', 'md:display': 'flex' })
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

describe('layerName', () => {
  const n = (id: string, type: string, props: DocNode['props'] = {}, children: DocNode[] = []): DocNode => ({ id, type, props, style: {}, children })
  const card: ComponentDefinition = {
    id: 'card',
    name: 'Card',
    root: n('c-root', 'Container', {}, [n('c-body', 'Container')]),
    properties: [{ id: 'body', name: 'Body', kind: 'slot', bindings: [{ nodeId: 'c-body', prop: 'children' }] }],
    variants: []
  }
  const main: Layout = {
    id: 'main',
    name: 'Main',
    root: n('l-root', 'Page', {}, [n('l-main', 'Container'), n('l-foot', 'Container')]),
    slots: [{ id: 'children', name: 'Content', nodeId: 'l-main' }, { id: 'footer', name: 'Footer', nodeId: 'l-foot' }],
    variables: []
  }
  const sources = { components: [card], layouts: [main] }
  const fill = n('fill', 'SlotFill', { slot: 'body' })
  const instance = n('inst', 'Instance', { component: 'card' }, [fill])
  const lost = n('lost', 'Instance', { component: 'gone' }, [n('lost-fill', 'SlotFill', { slot: 'body' })])
  const footer = n('foot', 'SlotFill', { slot: 'footer' })
  const page: Page = { id: 'home', name: 'Home', slug: 'home', layoutId: 'main', root: n('root', 'Page', {}, [footer, n('odd', 'SlotFill', { slot: 'nope' }), instance, lost, n('text', 'Text')]) }

  it('names an instance by its component and a slot fill by the slot it fills', () => {
    expect(layerName(page, instance, sources)).toBe('Card')
    expect(layerName(page, fill, sources)).toBe('Body')
    expect(layerName(page, footer, sources)).toBe('Footer')
  })

  it('falls back to the type for other nodes and unknown components or slots', () => {
    expect(layerName(page, findNode(page.root, 'text')!, sources)).toBe('Text')
    expect(layerName(page, lost, sources)).toBe('Instance')
    expect(layerName(page, findNode(page.root, 'lost-fill')!, sources)).toBe('SlotFill')
    expect(layerName(page, findNode(page.root, 'odd')!, sources)).toBe('SlotFill')
    expect(layerName({ ...page, layoutId: undefined }, footer, sources)).toBe('SlotFill')
  })

  it('uses the node\'s own name over any derived one', () => {
    expect(layerName(page, { ...n('t', 'Text'), name: 'Hero title' }, sources)).toBe('Hero title')
    expect(layerName(page, { ...instance, name: 'Main card' }, sources)).toBe('Main card')
    expect(layerName(page, { ...fill, name: 'Card body' }, sources)).toBe('Card body')
  })
})
