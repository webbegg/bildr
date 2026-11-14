import { describe, expect, it } from 'vitest'
import { applyEdit } from '../../src/edit/index'
import { loadModel } from '../../src/model/load'
import { generateUi } from '../../src/generate/index'
import { fixtureModelFiles } from '../model/fixture'
import { applyChanges, IDX, project } from './helpers'

it.each([
  ['component_create', { file: 'pg_index', nodeId: 'n_card', name: 'Wrapper' }],
  ['component_property_remove', { component: 'cmp_post_card', property: 'prop_post' }],
  ['component_property_update', { component: 'cmp_post_card', property: 'prop_post', name: 'article' }]
] as const)('%s leaves a model the generator can build, or is refused', (name, input) => {
  const files = fixtureModelFiles()
  const o = applyEdit(files, name, input)
  if (!o.ok) return expect(['invalid', 'forbidden']).toContain(o.code)
  const m = loadModel(applyChanges(files, o.changes))
  if (!m.ok) throw new Error('model')
  expect(() => generateUi(m.model)).not.toThrow()
})

describe('the generation backstop', () => {
  it('refuses an edit after which the model loads but doesn\'t generate, naming the file', () => {
    const outcome = project().refuse('node_update_props', { file: 'pg_index', nodeId: 'n_h1', props: { text: { $bind: 'nothing.here' } } }, 'invalid')
    expect(outcome.message).toBe('The edit would leave a model the generator can\'t build: .bildr/modules/blog/pages/index.json (node n_h1): "nothing.here" doesn\'t refer to anything this file uses')
    expect(outcome.problems).toEqual([{ path: IDX, message: '.bildr/modules/blog/pages/index.json (node n_h1): "nothing.here" doesn\'t refer to anything this file uses' }])
  })

  it('still edits a model that didn\'t generate before the edit', () => {
    const files = fixtureModelFiles()
    const broken = { ...files, [IDX]: files[IDX]!.replace('"text": "Posts"', '"text": { "$bind": "nothing" }') }
    const before = loadModel(broken)
    if (!before.ok) throw new Error('model')
    expect(() => generateUi(before.model)).toThrow('"nothing" doesn\'t refer to anything this file uses')
    project(broken).edit('node_rename', { file: 'pg_index', nodeId: 'n_about', name: 'About' })
  })
})
