// P3a: where a new page, component or layout file goes.
import { describe, expect, it } from 'vitest'
import { fixtureModelFiles } from '../model/fixture'
import { project } from './helpers'

const TIP = '.bildr/modules/blog/components/tip.json'

describe('new artifact files', () => {
  it('number a path another file has in other letter case (case-insensitive file systems)', () => {
    const files = fixtureModelFiles()
    const moved = { ...files, '.bildr/modules/blog/components/Grid.json': files[TIP]! }
    Reflect.deleteProperty(moved, TIP)
    const p = project(moved)
    expect(p.edit('component_create', { file: 'pg_index', nodeId: 'n_about' }).filePath).toBe('.bildr/modules/blog/components/grid-2.json')
  })

  it.each(['Con', 'nul', 'Com1', 'lpt9', 'aux', 'PRN'])('refuse a name Windows reserves for a device (%s)', (name) => {
    expect(project().refuse('component_create', { file: 'pg_index', nodeId: 'n_about', name }, 'invalid').message)
      .toBe(`"${name.toLowerCase()}" can't be a file name: Windows reserves it for a device. Pick another name`)
  })

  it('refuse reserved layout and page names too', () => {
    const p = project()
    expect(p.refuse('layout_create', { name: 'con' }, 'invalid').message).toBe('"con" can\'t be a file name: Windows reserves it for a device. Pick another name')
    expect(p.refuse('page_create', { name: 'aux' }, 'invalid').message).toBe('"aux" can\'t be a file name: Windows reserves it for a device. Pick another name')
  })
})
