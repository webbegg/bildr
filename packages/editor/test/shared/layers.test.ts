import { describe, expect, it } from 'vitest'
import type { ComponentFile, LayoutFile, ModelNode } from '@bildr/codegen/model'
import { devicesFor } from '@bildr/editor-core/styleFields'
import type { DeviceId } from '@bildr/editor-core/styleFields'
import { findNode } from '../../src/design/tree.ts'
import { collapsedAncestors, siblingMove, siblingMoves } from '../../src/editor/drop.ts'
import { hiddenBadge, layerFrames, layerKeyAction, layerName, naturalDisplay, visibilityAt, visibilityToggle, visibleLayers } from '../../src/shared/layers.ts'

/** Ported from the hosted `test/editor/layers.test.ts`, over `ModelNode` trees (children optional, as `.bildr` has them). */

/** Desktop, Tablet and Mobile shown: the frames these cascades are written against. */
const THREE: readonly DeviceId[] = ['desktop', 'tablet', 'mobile']

const n = (id: string, type: string, props: ModelNode['props'] = {}, children: ModelNode[] = []): ModelNode => ({ id, type, props, ...(children.length ? { children } : {}) })

/** root > [heading, card > [a, b]] */
const fixture = () => {
  const [a, b] = [n('a', 'Text'), n('b', 'Text')]
  const card = n('card', 'Card', {}, [a, b])
  const heading = n('heading', 'Heading')
  const root = n('root', 'Page', {}, [heading, card])
  return { root, card, a, b, heading }
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
    const { root } = fixture()
    expect(visibleLayers(root, new Set())).toEqual(['root', 'heading', 'card', 'a', 'b'])
    expect(visibleLayers(root, new Set(['card']))).toEqual(['root', 'heading', 'card'])
  })
})

describe('layerKeyAction', () => {
  it('moves the selection through the visible rows with ArrowUp and ArrowDown', () => {
    const { root } = fixture()
    expect(layerKeyAction(root, new Set(), 'heading', 'ArrowDown')).toEqual({ select: 'card' })
    expect(layerKeyAction(root, new Set(), 'card', 'ArrowDown')).toEqual({ select: 'a' })
    expect(layerKeyAction(root, new Set(['card']), 'card', 'ArrowDown')).toBeNull()
    expect(layerKeyAction(root, new Set(), 'heading', 'ArrowUp')).toEqual({ select: 'root' })
    expect(layerKeyAction(root, new Set(), 'root', 'ArrowUp')).toBeNull()
    expect(layerKeyAction(root, new Set(), null, 'ArrowDown')).toEqual({ select: 'root' })
  })

  it('collapses or goes to the parent with ArrowLeft, and expands with ArrowRight', () => {
    const { root } = fixture()
    expect(layerKeyAction(root, new Set(), 'card', 'ArrowLeft')).toEqual({ collapse: 'card' })
    expect(layerKeyAction(root, new Set(['card']), 'card', 'ArrowLeft')).toEqual({ select: 'root' })
    expect(layerKeyAction(root, new Set(), 'a', 'ArrowLeft')).toEqual({ select: 'card' })
    expect(layerKeyAction(root, new Set(['card']), 'card', 'ArrowRight')).toEqual({ expand: 'card' })
    expect(layerKeyAction(root, new Set(), 'card', 'ArrowRight')).toBeNull()
    expect(layerKeyAction(root, new Set(), 'a', 'Enter')).toBeNull()
  })
})

describe('collapsedAncestors', () => {
  it('names the collapsed rows hiding a node', () => {
    const { root } = fixture()
    expect(collapsedAncestors(root, new Set(['card', 'root']), 'a')).toEqual(['root', 'card'])
    expect(collapsedAncestors(root, new Set(['card']), 'card')).toEqual([])
  })
})

describe('siblingMove', () => {
  it('gives the node_move slot one step up or down among the siblings', () => {
    const { root } = fixture()
    expect(siblingMove(root, 'b', -1)).toEqual({ parentId: 'card', index: 0 })
    expect(siblingMove(root, 'a', 1)).toEqual({ parentId: 'card', index: 1 })
    expect(siblingMove(root, 'heading', -1)).toBeNull()
    expect(siblingMove(root, 'b', 1)).toBeNull()
    expect(siblingMove(root, 'root', 1)).toBeNull()
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
    expect(hiddenBadge(style, 'tablet', THREE)).toBe('base lg')
    expect(hiddenBadge(style, 'mobile', THREE)).toBeNull()
    expect(hiddenBadge({ 'md:display': 'hidden', 'lg:display': 'flex' }, 'desktop', THREE)).toBe('md')
    expect(hiddenBadge({}, 'mobile', THREE)).toBeNull()
  })

  it('badges over the shown frames, Large phone (sm) only when shown', () => {
    const style = { 'display': 'hidden', 'md:display': 'block' }
    expect(hiddenBadge(style, 'tablet', THREE)).toBe('base')
    expect(hiddenBadge(style, 'tablet', ['desktop', 'tablet', 'large-phone', 'mobile'])).toBe('base sm')
  })
})

describe('naturalDisplay', () => {
  it('is the display a node renders with when no display token applies', () => {
    expect(naturalDisplay({ type: 'Row' })).toBe('flex')
    expect(naturalDisplay({ type: 'Column' })).toBe('flex')
    expect(naturalDisplay({ type: 'Button' })).toBe('flex')
    expect(naturalDisplay({ type: 'Grid' })).toBe('grid')
    expect(naturalDisplay({ type: 'List', props: { layout: 'grid' } })).toBe('grid')
    expect(naturalDisplay({ type: 'List', props: {} })).toBe('flex')
    expect(naturalDisplay({ type: 'Text' })).toBe('block')
    expect(naturalDisplay({ type: 'Card' })).toBe('block')
  })
})

describe('visibilityToggle', () => {
  it('hides at the device breakpoint only, keeping wider devices as they were', () => {
    expect(visibilityToggle({}, 'mobile', 'block', THREE)).toEqual({ 'display': 'hidden', 'md:display': 'block' })
    expect(visibilityToggle({}, 'tablet', 'flex', THREE)).toEqual({ 'md:display': 'hidden', 'lg:display': 'flex' })
    expect(visibilityToggle({}, 'desktop', 'flex', THREE)).toEqual({ 'lg:display': 'hidden' })
    expect(visibilityToggle({ display: 'grid' }, 'mobile', 'grid', THREE)).toEqual({ 'display': 'hidden', 'md:display': 'grid' })
    expect(visibilityToggle({ 'md:display': 'grid' }, 'mobile', 'flex', THREE)).toEqual({ display: 'hidden' })
    expect(visibilityToggle(undefined, 'desktop', 'flex', THREE)).toEqual({ 'lg:display': 'hidden' })
  })

  it('shows again by removing the hide, undoing the override it wrote above', () => {
    expect(visibilityToggle({ 'display': 'hidden', 'md:display': 'block' }, 'mobile', 'block', THREE)).toEqual({ 'display': null, 'md:display': null })
    expect(visibilityToggle({ 'md:display': 'hidden', 'lg:display': 'flex' }, 'tablet', 'flex', THREE)).toEqual({ 'md:display': null, 'lg:display': null })
    expect(visibilityToggle({ 'lg:display': 'hidden' }, 'desktop', 'flex', THREE)).toEqual({ 'lg:display': null })
  })

  it('works over the shown frames: with Large phone shown, Mobile hands over to sm', () => {
    const shown = ['desktop', 'tablet', 'large-phone', 'mobile'] as const
    expect(visibilityToggle({}, 'mobile', 'block', shown)).toEqual({ 'display': 'hidden', 'sm:display': 'block' })
    expect(visibilityToggle({}, 'large-phone', 'flex', shown)).toEqual({ 'sm:display': 'hidden', 'md:display': 'flex' })
    expect(visibilityToggle({ 'display': 'hidden', 'sm:display': 'block' }, 'mobile', 'block', shown)).toEqual({ 'display': null, 'sm:display': null })
  })

  it('includes the edited device even when its frame is not in the shown list', () => {
    expect(visibilityToggle({}, 'large-phone', 'flex', THREE)).toEqual({ 'sm:display': 'hidden', 'md:display': 'flex' })
  })

  it('shows a node hidden from a smaller breakpoint with its natural display', () => {
    expect(visibilityToggle({ 'md:display': 'hidden' }, 'desktop', 'flex', THREE)).toEqual({ 'lg:display': 'flex' })
    expect(visibilityToggle({ display: 'hidden' }, 'tablet', 'block', THREE)).toEqual({ 'md:display': 'block', 'lg:display': 'hidden' })
  })

  it('hides a desktop-first project at its own cascade (the Primary is Desktop)', () => {
    expect(visibilityToggle({}, 'desktop', 'block', ['desktop', 'tablet'], 'desktop')).toEqual({ 'display': 'hidden', 'max-lg:display': 'block' })
  })
})

describe('siblingMoves', () => {
  /** root > [x, y, z, w, v] as Texts. */
  const row = () => {
    const ids = ['x', 'y', 'z', 'w', 'v']
    return { root: n('root', 'Page', {}, ids.map(id => n(id, 'Text'))), ids }
  }

  it('moves each selected node one step, in an order where each move keeps its index meaning', () => {
    const { root } = row()
    expect(siblingMoves(root, ['w', 'y'], -1)).toEqual([
      { nodeId: 'y', parentId: 'root', index: 0 },
      { nodeId: 'w', parentId: 'root', index: 2 }
    ])
    expect(siblingMoves(root, ['x', 'z'], 1)).toEqual([
      { nodeId: 'z', parentId: 'root', index: 3 },
      { nodeId: 'x', parentId: 'root', index: 1 }
    ])
  })

  it('refuses the whole move when one node is at the end of its siblings', () => {
    const { root } = row()
    expect(siblingMoves(root, ['y', 'x'], -1)).toBeNull()
    expect(siblingMoves(root, ['v'], 1)).toBeNull()
    expect(siblingMoves(root, ['root'], 1)).toBeNull()
  })
})

describe('layerName', () => {
  const card: ComponentFile = {
    id: 'card',
    name: 'Card',
    root: n('c-root', 'Container', {}, [n('c-body', 'Container')]),
    properties: [{ id: 'body', name: 'body', label: 'Body', kind: 'slot', nodeId: 'c-body' }],
    variants: []
  } as unknown as ComponentFile
  const main: LayoutFile = {
    id: 'main',
    name: 'main',
    root: n('l-root', 'Page', {}, [n('l-main', 'Container'), n('l-foot', 'Container')]),
    slots: [{ id: 'children', name: 'Content', nodeId: 'l-main' }, { id: 'footer', name: 'Footer', nodeId: 'l-foot' }]
  } as unknown as LayoutFile
  const sources = { components: [card], layouts: [main] }
  const fill = n('fill', 'SlotFill', { slot: 'body' })
  const instance = n('inst', 'Instance', { component: 'card' }, [fill])
  const lost = n('lost', 'Instance', { component: 'gone' }, [n('lost-fill', 'SlotFill', { slot: 'body' })])
  const footer = n('foot', 'SlotFill', { slot: 'footer' })
  const page = { layout: 'main', root: n('root', 'Page', {}, [footer, n('odd', 'SlotFill', { slot: 'nope' }), instance, lost, n('text', 'Text')]) }

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
    expect(layerName({ root: page.root }, footer, sources)).toBe('SlotFill')
  })

  it('uses the node\'s own name over any derived one', () => {
    expect(layerName(page, { ...n('t', 'Text'), name: 'Hero title' }, sources)).toBe('Hero title')
    expect(layerName(page, { ...instance, name: 'Main card' }, sources)).toBe('Main card')
    expect(layerName(page, { ...fill, name: 'Card body' }, sources)).toBe('Card body')
  })
})
