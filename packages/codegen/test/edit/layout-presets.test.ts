// layout-containers T5: Stack, Row, Column and Grid are presets of one Container.
import { describe, expect, it } from 'vitest'
import { applyEdit } from '../../src/edit/index'
import { toA2ui } from '../../src/a2ui/index'
import { baseLayout } from '../../src/render/index'
import { childIds, findNode, IDX, project } from './helpers'
import type { Json } from './helpers'
import { fixtureModelFiles } from '../model/fixture'

describe('baseLayout', () => {
  it('reads how a node lays out its children from its type and its base display and direction tokens', () => {
    expect(baseLayout('Container')).toBe('col')
    expect(baseLayout('Row')).toBe('row')
    expect(baseLayout('Grid')).toBe('grid')
    expect(baseLayout('Container', {}, { direction: 'row' })).toBe('row')
    expect(baseLayout('Container', {}, { direction: 'row-reverse' })).toBe('row')
    expect(baseLayout('Container', {}, { display: 'grid' })).toBe('grid')
    expect(baseLayout('Container', {}, { display: 'block' })).toBe('block')
    expect(baseLayout('Container', {}, { 'md:direction': 'row' })).toBe('col')
    expect(baseLayout('List', { layout: 'row' })).toBe('row')
    expect(baseLayout('Card', {}, { display: 'grid' })).toBe('col')
    expect(baseLayout('Text')).toBe('block')
  })
})

describe('node_insert with a preset', () => {
  it('stores a Container with the preset\'s tokens, its id named after the preset', () => {
    const p = project()
    const { nodeId } = p.edit('node_insert', { file: 'pg_index', preset: 'Row' })
    expect(nodeId).toBe('n_row_1')
    expect(findNode(p.json(IDX).root, nodeId)).toEqual({ id: 'n_row_1', type: 'Container', style: { direction: 'row', flexWrap: 'wrap', gap: '3', items: 'center' } })
    const grid = p.edit('node_insert', { file: 'pg_index', preset: 'Grid', style: { cols: '2' } })
    expect(findNode(p.json(IDX).root, grid.nodeId)).toMatchObject({ type: 'Container', style: { display: 'grid', cols: '2', gap: '6' } })
    const column = p.edit('node_insert', { file: 'pg_index', preset: 'Column' })
    expect(findNode(p.json(IDX).root, column.nodeId)).toMatchObject({ type: 'Container', style: { direction: 'col', gap: '3', items: 'start' } })
  })

  it('gives a Stack what a Container gets', () => {
    const p = project()
    const stack = p.edit('node_insert', { file: 'pg_index', preset: 'Stack' })
    const container = p.edit('node_insert', { file: 'pg_index', type: 'Container' })
    const { id: _stack, ...stackNode } = findNode(p.json(IDX).root, stack.nodeId)!
    const { id: _container, ...containerNode } = findNode(p.json(IDX).root, container.nodeId)!
    expect(stackNode).toEqual(containerNode)
  })

  it('takes presets in children too, and still takes the legacy Row, Column and Grid types', () => {
    const p = project()
    const { nodeId } = p.edit('node_insert', { file: 'pg_index', preset: 'Column', children: [{ preset: 'Row' }, { type: 'Row' }] })
    const [row, legacy] = findNode(p.json(IDX).root, nodeId)!.children as Json[]
    expect(row).toMatchObject({ type: 'Container', style: { direction: 'row' } })
    expect(legacy).toMatchObject({ type: 'Row', props: { wrap: true } })
  })

  it('refuses an unknown preset, or one whose type is not the given type', () => {
    const p = project()
    expect(p.refuse('node_insert', { file: 'pg_index', preset: 'Masonry' }, 'invalid').message).toBe('Unknown preset "Masonry": one of Stack, Row, Column, Grid')
    expect(p.refuse('node_insert', { file: 'pg_index', preset: 'Row', type: 'Text' }, 'invalid').message).toBe('The Row preset is a Container, not a Text')
    expect(applyEdit(fixtureModelFiles(), 'node_insert', { file: 'pg_index' })).toMatchObject({ ok: false, code: 'invalid_input' })
  })
})

describe('node_wrap with a preset', () => {
  it('wraps siblings in a Container with the preset\'s tokens', () => {
    const p = project()
    const { nodeId } = p.edit('node_wrap', { file: 'pg_index', nodeIds: ['n_quotes', 'n_list'], preset: 'Row', style: { gap: '8' } })
    const row = findNode(p.json(IDX).root, nodeId)!
    expect(row).toMatchObject({ id: 'n_row_1', type: 'Container', style: { direction: 'row', flexWrap: 'wrap', gap: '8', items: 'center' } })
    expect(childIds(row)).toEqual(['n_quotes', 'n_list'])
    expect(p.refuse('node_wrap', { file: 'pg_index', nodeIds: ['n_quotes'], preset: 'Row', type: 'Card' }, 'invalid').message).toBe('The Row preset is a Container, not a Card')
  })
})

describe('catalog_get', () => {
  it('lists the presets as insertable Containers and the legacy layout types as not insertable', () => {
    const outcome = applyEdit(fixtureModelFiles(), 'catalog_get', {})
    if (!outcome.ok) throw new Error(outcome.message)
    const types = (outcome.result as Json).nodeTypes as Json[]
    const presets = types.filter(entry => entry.preset)
    expect(presets.map(entry => [entry.preset, entry.type, entry.insertable])).toEqual([
      ['Stack', 'Container', true], ['Row', 'Container', true], ['Column', 'Container', true], ['Grid', 'Container', true]
    ])
    expect(presets.find(entry => entry.preset === 'Row')).toMatchObject({ label: 'Row', defaults: { props: {}, style: { direction: 'row', flexWrap: 'wrap', gap: '3', items: 'center' } } })
    for (const type of ['Row', 'Column', 'Grid']) {
      expect(types.find(entry => entry.type === type && !entry.preset)).toMatchObject({ insertable: false, description: expect.stringContaining(`preset "${type}"`) })
    }
  })
})

describe('toA2ui', () => {
  it('draws a Container laid out as a row as a Row; its wrap is lost, as a Row\'s `wrap` is', () => {
    const { message, lost } = toA2ui({ id: 'n_root', type: 'Container', style: { direction: 'row', flexWrap: 'wrap', justify: 'between' }, children: [{ id: 'n_text', type: 'Text', props: { text: 'a' } }] }, { surfaceId: 's' })
    expect(message.createSurface.components[0]).toMatchObject({ id: 'root', component: 'Row', justify: 'spaceBetween' })
    expect(lost).toEqual([{ nodeId: 'n_root', kind: 'style', detail: 'flexWrap' }])
    expect(toA2ui({ id: 'n_root', type: 'Row', props: { wrap: true } }, { surfaceId: 's' }).lost).toEqual([{ nodeId: 'n_root', kind: 'prop', detail: 'wrap' }])
  })

  it('draws a Container laid out as a grid as a Column, saying the grid is lost', () => {
    const { message, lost } = toA2ui({ id: 'n_root', type: 'Container', style: { display: 'grid', cols: '3' } }, { surfaceId: 's' })
    expect(message.createSurface.components[0]).toMatchObject({ component: 'Column' })
    expect(lost).toContainEqual({ nodeId: 'n_root', kind: 'node', detail: 'Grid becomes a Column: its columns and spans are lost' })
  })
})
