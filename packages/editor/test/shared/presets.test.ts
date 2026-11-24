import { describe, expect, it } from 'vitest'
import { PALETTE } from '../../../codegen/src/edit/palette.ts'
import { layerName } from '../../src/shared/layers.ts'
import { insertId, insertSpec, isFlattenable, layoutIcon, legacyLayouts } from '../../src/shared/presets.ts'

// layout-containers T5: the editor inserts and wraps with the layout presets, and names a Container by its layout.

describe('insertSpec', () => {
  it('sends a preset name as a preset, anything else as a type', () => {
    expect(insertSpec('Row')).toEqual({ preset: 'Row' })
    expect(insertSpec('Stack')).toEqual({ preset: 'Stack' })
    expect(insertSpec('Grid')).toEqual({ preset: 'Grid' })
    expect(insertSpec('Text')).toEqual({ type: 'Text' })
    expect(insertSpec('Container')).toEqual({ type: 'Container' })
  })

  it('keys a catalog entry by its preset, or its type', () => {
    expect(insertId({ type: 'Container', preset: 'Row' })).toBe('Row')
    expect(insertId({ type: 'Text' })).toBe('Text')
  })

  it('keys the palette (what catalog_get lists as insertable) by the presets, once each', () => {
    const ids = PALETTE.map(insertId)
    expect(ids.slice(0, 5)).toEqual(['Stack', 'Row', 'Column', 'Grid', 'Card'])
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('legacyLayouts', () => {
  it('lists the Rows, Columns, Grids and Cards at and under a node, which Convert to Container converts', () => {
    const tree = { id: 'r', type: 'Row', children: [{ id: 'c', type: 'Container', children: [{ id: 'g', type: 'Grid' }] }, { id: 'k', type: 'Card' }, { id: 't', type: 'Text' }] }
    expect(legacyLayouts(tree).map(node => node.id)).toEqual(['r', 'g', 'k'])
    expect(legacyLayouts({ id: 'c', type: 'Container' })).toEqual([])
  })
})

describe('a Container in the layers', () => {
  const file = { root: { id: 'root', type: 'Page' } }
  const sources = { components: [], layouts: [] }

  it('is named and drawn by its layout: Stack, Row or Grid', () => {
    expect(layerName(file, { id: 'a', type: 'Container' }, sources)).toBe('Stack')
    expect(layerName(file, { id: 'a', type: 'Container', style: { direction: 'row' } }, sources)).toBe('Row')
    expect(layerName(file, { id: 'a', type: 'Container', style: { display: 'grid' } }, sources)).toBe('Grid')
    expect(layerName(file, { id: 'a', type: 'Container', style: { display: 'block' } }, sources)).toBe('Container')
    expect(layerName(file, { id: 'a', type: 'Container', name: 'Hero' }, sources)).toBe('Hero')
    // Legacy types keep their names.
    expect(layerName(file, { id: 'a', type: 'Column' }, sources)).toBe('Column')
    expect(layoutIcon({ type: 'Container', style: { direction: 'row' } })).toBe('i-lucide-arrow-right')
    expect(layoutIcon({ type: 'Container' })).toBe('i-lucide-arrow-down')
    expect(layoutIcon({ type: 'Container', style: { display: 'grid' } })).toBe('i-lucide-grid-3x3')
    expect(layoutIcon({ type: 'Row' })).toBe('i-lucide-arrow-right')
    expect(layoutIcon({ type: 'Text' })).toBeUndefined()
  })
})

describe('isFlattenable (layout-containers L4)', () => {
  const text = { id: 'n_t', type: 'Text' }
  it('flags a Container that only wraps one node and adds nothing of its own', () => {
    expect(isFlattenable({ id: 'n_c', type: 'Container', children: [text] })).toBe(true)
    expect(isFlattenable({ id: 'n_c', type: 'Container', style: {}, children: [text] })).toBe(true)
  })

  it('leaves one with a style, props, interactions, a name, a lock, two children or none, and the legacy types', () => {
    const plain = { id: 'n_c', type: 'Container', children: [text] }
    expect(isFlattenable({ ...plain, style: { p: '4' } })).toBe(false)
    expect(isFlattenable({ ...plain, props: { tag: 'section' } })).toBe(false)
    expect(isFlattenable({ ...plain, interactions: [{ event: 'click', steps: [] }] } as never)).toBe(false)
    expect(isFlattenable({ ...plain, name: 'Hero' })).toBe(false)
    expect(isFlattenable({ ...plain, locked: true })).toBe(false)
    expect(isFlattenable({ ...plain, children: [text, { id: 'n_u', type: 'Text' }] })).toBe(false)
    expect(isFlattenable({ ...plain, children: [] })).toBe(false)
    expect(isFlattenable({ ...plain, type: 'Row' })).toBe(false)
  })
})
