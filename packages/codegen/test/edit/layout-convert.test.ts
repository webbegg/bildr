// layout-containers T7: a legacy layout node (Row, Column, Grid, Card) becomes a Container with explicit tokens.
import { describe, expect, it } from 'vitest'
import { normalizeLayout } from '../../src/edit/convert'
import { generateUi } from '../../src/generate/ui'
import { loadModel } from '../../src/model/load'
import type { ModelNode } from '../../src/model/schemas'
import { fixtureModelFiles } from '../model/fixture'
import { LEGACY_LAYOUT_TREE } from '../generate/layout-legacy.fixture'
import { CARD, childIds, findNode, IDX, project } from './helpers'
import type { Json } from './helpers'

const convert = (node: ModelNode) => normalizeLayout(node)

describe('normalizeLayout', () => {
  it('turns a Row into a Container laid out as a row, its wrap prop a flexWrap token', () => {
    expect(convert({ id: 'a', type: 'Row', props: { wrap: true, tag: 'nav' }, style: { gap: '3' } }))
      .toEqual({ id: 'a', type: 'Container', props: { tag: 'nav' }, style: { gap: '3', direction: 'row', flexWrap: 'wrap' } })
    expect(convert({ id: 'a', type: 'Row', props: { wrap: false } })).toEqual({ id: 'a', type: 'Container', style: { direction: 'row' } })
    expect(convert({ id: 'a', type: 'Row', style: { 'direction': 'col', 'md:direction': 'row' } })).toEqual({ id: 'a', type: 'Container', style: { 'direction': 'col', 'md:direction': 'row' } })
    expect(convert({ id: 'a', type: 'Row', props: { wrap: true }, style: { flexWrap: 'nowrap' } }).style).toEqual({ direction: 'row', flexWrap: 'nowrap' })
  })

  it('turns a Column into a Container, a Grid into one with display: grid', () => {
    expect(convert({ id: 'a', type: 'Column', style: { gap: '2' }, children: [{ id: 'b', type: 'Text' }] }))
      .toEqual({ id: 'a', type: 'Container', style: { gap: '2' }, children: [{ id: 'b', type: 'Text' }] })
    expect(convert({ id: 'a', type: 'Grid', style: { 'cols': '3', 'md:display': 'hidden' } })).toEqual({ id: 'a', type: 'Container', style: { 'cols': '3', 'md:display': 'hidden', 'display': 'grid' } })
    expect(convert({ id: 'a', type: 'Grid', style: { display: 'grid' } }).style).toEqual({ display: 'grid' })
  })

  it('refuses a Grid hidden at its base, which no token could keep a grid where it shows again', () => {
    expect(() => convert({ id: 'a', type: 'Grid', style: { display: 'hidden' } })).toThrow('Show this Grid on its base breakpoint before converting it: it sets display "hidden" there')
  })

  it('turns a Card into a Container named Card with its surface as tokens; its own tokens win', () => {
    expect(convert({ id: 'a', type: 'Card', style: { gap: '3', p: '4' } })).toEqual({
      id: 'a', type: 'Container', name: 'Card',
      style: { p: '4', rounded: 'lg', bg: 'default', overflow: 'hidden', border: '1', borderColor: 'default', gap: '3' }
    })
    expect(convert({ id: 'a', type: 'Card', name: 'Price' }).name).toBe('Price')
    // The card's display was its surface's (a block): the Container's is its stack's (flex).
    expect(convert({ id: 'a', type: 'Card', style: { 'display': 'hidden', 'md:display': 'block' } }).style).toMatchObject({ 'display': 'hidden', 'md:display': 'flex' })
  })

  it('leaves every other node as it is', () => {
    const text = { id: 'a', type: 'Text', props: { text: 'x' } }
    expect(convert(text)).toBe(text)
    const container = { id: 'a', type: 'Container', style: { direction: 'row' } }
    expect(convert(container)).toBe(container)
  })
})

/** The class sets of the generated markup's elements, in document order. */
const classSets = (tree: ModelNode): string[][] => {
  const loaded = loadModel(fixtureModelFiles())
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
  loaded.model.modules.blog!.pages.find(page => page.name === 'index')!.root.children = [tree]
  const page = generateUi(loaded.model).find(file => file.path.endsWith('pages/index.vue'))!.content
  return [...page.matchAll(/ class="([^"]*)"/g)].map(match => match[1]!.split(' ').sort())
}
const deep = (node: ModelNode): ModelNode => ({ ...normalizeLayout(node), ...(node.children ? { children: node.children.map(deep) } : {}) })

describe('converted layouts render as before', () => {
  it('give every element the classes it had (a converted Grid adds a flex-col, which a grid ignores)', () => {
    const legacy = { ...LEGACY_LAYOUT_TREE, children: LEGACY_LAYOUT_TREE.children!.filter(child => child.type !== 'Card') }
    const before = classSets(legacy)
    const after = classSets(deep(legacy))
    expect(after).toHaveLength(before.length)
    after.forEach((classes, index) => {
      const added = classes.filter(entry => !before[index]!.includes(entry))
      expect({ index, added, removed: before[index]!.filter(entry => !classes.includes(entry)) }).toEqual({ index, added: added.filter(entry => entry === 'flex-col' && classes.includes('grid')), removed: [] })
    })
  })
})

describe('node_convert', () => {
  it('converts a legacy layout node in place, or every one in its subtree, keeping ids and children', () => {
    const p = project()
    const { nodeId } = p.edit('node_insert', { file: 'pg_index', type: 'Column', children: [{ type: 'Row' }, { type: 'Text', props: { text: 'x' } }, { type: 'Grid', children: [{ type: 'Card' }] }] })
    const column = findNode(p.json(IDX).root, nodeId)!
    const [row, text, grid] = column.children as Json[]
    expect(p.edit('node_convert', { file: 'pg_index', nodeId })).toMatchObject({ converted: [nodeId] })
    expect(findNode(p.json(IDX).root, nodeId)).toMatchObject({ type: 'Container' })
    expect(findNode(p.json(IDX).root, row!.id)).toMatchObject({ type: 'Row' })
    expect(p.edit('node_convert', { file: 'pg_index', nodeId, subtree: true }).converted).toEqual([row!.id, grid!.id, grid!.children[0].id])
    const after = findNode(p.json(IDX).root, nodeId)!
    expect(childIds(after)).toEqual([row!.id, text!.id, grid!.id])
    expect((after.children as Json[]).map(child => child.type)).toEqual(['Container', 'Text', 'Container'])
    expect(findNode(p.json(IDX).root, grid!.children[0].id)).toMatchObject({ type: 'Container', name: 'Card' })
  })

  it('refuses a node that is no legacy layout type, and a subtree without one', () => {
    const p = project()
    expect(p.refuse('node_convert', { file: 'pg_index', nodeId: 'n_h1' }, 'invalid').message).toBe('A Heading is no legacy layout type (Row, Column, Grid or Card): nothing to convert')
    expect(p.refuse('node_convert', { file: 'pg_index', nodeId: 'n_h1', subtree: true }, 'invalid').message).toBe('No Row, Column, Grid or Card in this subtree: nothing to convert')
  })

  it('converts a component\'s variant overrides of the node too', () => {
    const p = project()
    const root = p.json(CARD).root as Json
    const { nodeId } = p.edit('node_insert', { file: 'cmp_post_card', parentId: root.id, type: 'Row' })
    const variant = (p.json(CARD).variants as Json[])[0]!
    // The Row wraps (its default); the variant doesn't.
    p.edit('component_variant_set_override', { component: 'cmp_post_card', variant: variant.id, nodeId, props: { wrap: false } })
    p.edit('node_convert', { file: 'cmp_post_card', nodeId })
    expect(findNode(p.json(CARD).root, nodeId)).toMatchObject({ type: 'Container', style: { direction: 'row', flexWrap: 'wrap' } })
    const override = (p.json(CARD).variants as Json[])[0]!.overrides[nodeId]
    expect(override).toEqual({ style: { flexWrap: 'nowrap' } })
  })
})

describe('node_insert_a2ui', () => {
  it('inserts Containers, not legacy layout types', () => {
    const p = project()
    const { nodeId } = p.edit('node_insert_a2ui', { file: 'pg_index', components: [
      { id: 'root', component: 'Card', child: 'body' },
      { id: 'body', component: 'Row', children: ['a'] },
      { id: 'a', component: 'Text', text: 'Hi' }
    ] })
    const card = findNode(p.json(IDX).root, nodeId)!
    expect(card).toMatchObject({ type: 'Container', name: 'Card' })
    expect(card.children[0]).toMatchObject({ type: 'Container', style: { direction: 'row' } })
  })
})
