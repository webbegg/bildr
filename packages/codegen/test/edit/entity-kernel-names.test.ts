// codegen-architecture T6: an entity's name becomes a type the generated files declare next to the core's own (Result, Page…).
import { describe, expect, it } from 'vitest'
import { loadModel } from '../../src/model/load'
import { fixtureModelFiles } from '../model/fixture'
import { generated } from './behaviour-helpers'
import { project } from './helpers'

const FIELDS = [{ name: 'label', type: 'text', required: true }]

describe('an entity named like a type of the core', () => {
  it.each(['Result', 'result', 'Page', 'PageRequest', 'Id', 'Timestamp', 'ApiError', 'DomainError'])('%s is refused, saying what it would clash with', (name) => {
    const p = project()
    expect(p.refuse('entity_create', { name, source: 'ds_main', fields: FIELDS }, 'invalid').message)
      .toMatch(/^"\w+" is a type of the generated app's core \(#core\/kernel\): name the entity otherwise, like "\w+Item"$/)
    expect(p.refuse('entity_update', { entity: 'ent_post', name }, 'invalid').message).toContain('is a type of the generated app\'s core')
  })

  it('a model file written by hand with such a name doesn\'t load', () => {
    const files = fixtureModelFiles()
    const path = Object.keys(files).find(file => /\/entities\/post\.json$/.test(file))!
    const loaded = loadModel({ ...files, [path]: JSON.stringify({ ...JSON.parse(files[path]!), name: 'Result' }) })
    expect(loaded.ok).toBe(false)
    expect(!loaded.ok && loaded.problems).toContainEqual({ path, message: 'name: "Result" is a type of the generated app\'s core (#core/kernel): name the entity otherwise, like "ResultItem"' })
  })

  it('a name that only starts like one is taken, and generates', () => {
    const p = project()
    p.edit('entity_create', { name: 'ResultSet', source: 'ds_main', fields: FIELDS })
    expect(Object.keys(generated(p.files)).some(path => path.endsWith('/result-set.ts'))).toBe(true)
  })
})
