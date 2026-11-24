// layout-containers L5: the Overlay, Section and Columns presets, and the new tokens through node_update_style.
import { describe, expect, it } from 'vitest'
import { findNode, IDX, project } from './helpers'
import { fixtureModelFiles } from '../model/fixture'

const desktopFiles = () => {
  const files = fixtureModelFiles()
  const config = JSON.parse(files['.bildr/bildr.json']!)
  files['.bildr/bildr.json'] = JSON.stringify({ ...config, breakpointBase: 'desktop' })
  return files
}

describe('the L5 presets', () => {
  it('Overlay: a grid whose children share its one cell', () => {
    const p = project()
    const { nodeId } = p.edit('node_insert', { file: 'pg_index', preset: 'Overlay' })
    expect(nodeId).toBe('n_overlay_1')
    expect(findNode(p.json(IDX).root, nodeId)).toEqual({ id: 'n_overlay_1', type: 'Container', name: 'Overlay', style: { display: 'grid', overlay: 'stack', items: 'center', justify: 'center' } })
  })

  it('Section: a full-width <section> with roomy padding', () => {
    const p = project()
    const { nodeId } = p.edit('node_insert', { file: 'pg_index', preset: 'Section' })
    expect(findNode(p.json(IDX).root, nodeId)).toEqual({ id: 'n_section_1', type: 'Container', name: 'Section', props: { tag: 'section' }, style: { w: 'fill', px: '6', py: '16', gap: '6' } })
  })

  it('Columns: a column on phones that becomes a row from md, written in the project\'s own breakpoints', () => {
    const p = project()
    const mobile = p.edit('node_insert', { file: 'pg_index', preset: 'Columns' })
    expect(findNode(p.json(IDX).root, mobile.nodeId)).toEqual({ id: 'n_columns_1', type: 'Container', name: 'Columns', style: { 'direction': 'col', 'md:direction': 'row', 'gap': '6' } })
    const d = project(desktopFiles())
    const desktop = d.edit('node_insert', { file: 'pg_index', preset: 'Columns' })
    expect(findNode(d.json(IDX).root, desktop.nodeId)!.style).toEqual({ 'direction': 'row', 'max-md:direction': 'col', 'gap': '6' })
  })

  it('wraps in the new presets too', () => {
    const p = project()
    p.edit('node_wrap', { file: 'pg_index', nodeId: 'n_h1', preset: 'Overlay' })
    expect(findNode(p.json(IDX).root, 'n_overlay_1')).toMatchObject({ style: { display: 'grid', overlay: 'stack' }, children: [{ id: 'n_h1' }] })
  })
})

describe('the L5 tokens', () => {
  it('pins, layers and splits through node_update_style', () => {
    const p = project()
    p.edit('node_update_style', { file: 'pg_index', nodeId: 'n_h1', style: { position: 'absolute', top: '0', insetX: '0', z: '10', order: 'last' } })
    p.edit('node_update_style', { file: 'pg_index', nodeId: 'n_head', style: { position: 'relative', gapX: '2', gapY: '6', overflowX: 'auto', cols: 'auto-fit', colMin: '48', rows: '2' } })
    expect(findNode(p.json(IDX).root, 'n_h1')!.style).toMatchObject({ position: 'absolute', top: '0', insetX: '0', z: '10', order: 'last' })
    expect(findNode(p.json(IDX).root, 'n_head')!.style).toMatchObject({ gapX: '2', gapY: '6', cols: 'auto-fit', colMin: '48' })
    expect(p.refuse('node_update_style', { file: 'pg_index', nodeId: 'n_h1', style: { z: '15' } }, 'invalid').message).toBe('"15" is not a value of style token "z"')
  })
})
