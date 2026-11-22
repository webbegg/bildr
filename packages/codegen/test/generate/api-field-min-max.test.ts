// API model min/max: a text field's length or a number field's range, checked on what the app sends (the model's schema: a body, the
// server route's body), never on what the API answers (its DTO), so a remote that drifts still loads.
import { describe, expect, it } from 'vitest'
import { generate } from '../../src/generate/index'
import { loadModel } from '../../src/model/load'
import { sampleModel } from '../../src/generate/api-model'
import type { ApiSource } from '../../src/model/load'
import { fixtureModelFiles } from '../model/fixture'

const FILE = '.bildr/datasources/shop-api.json'
const source = (fields: unknown[]) => ({
  id: 'ds_shop_api',
  name: 'shop-api',
  kind: 'api',
  env: { baseUrl: 'NUXT_APIS_SHOP_API_BASE_URL' },
  baseUrl: 'https://x.example.com/v1',
  runtime: 'server',
  models: [{ name: 'Contact', fields }],
  queries: [{ name: 'contacts', path: '/contacts', params: [], result: { model: 'Contact', many: true } }],
  actions: [{ name: 'addContact', method: 'POST', path: '/contacts', params: [], body: { model: 'Contact' } }]
})
const load = (fields: unknown[]) => loadModel({ ...fixtureModelFiles(), [FILE]: JSON.stringify(source(fields)) })
const messages = (fields: unknown[]) => {
  const loaded = load(fields)
  return loaded.ok ? [] : loaded.problems.map(problem => problem.message.replace(/^[\w.[\]]+: /, ''))
}
const read = (fields: unknown[], path: string) => {
  const loaded = load(fields)
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
  return generate(loaded.model).find(file => file.path === path)!.content
}
const FIELDS = [
  { name: 'name', type: 'text', min: 2, max: 80 },
  { name: 'age', type: 'integer', min: 0 },
  { name: 'price', type: 'money', currency: 'EUR', max: 1000 },
  { name: 'tags', type: 'text', max: 20, list: true, optional: true }
]

describe('an API model field\'s min and max', () => {
  it('check the model\'s schema: a text\'s length, a number\'s range, each item of a list', () => {
    const entity = read(FIELDS, 'layers/apis/shared/domain/shop-api/entities/contact.ts')
    expect(entity).toContain('  name: z.string().min(2).max(80),')
    expect(entity).toContain('  age: z.number().int().min(0),')
    expect(entity).toContain('  price: z.number().max(1000),')
    expect(entity).toContain('  tags: z.array(z.string().max(20)).optional()')
  })

  it('are not checked on the answer, which still loads when the remote sends more', () => {
    const dto = read(FIELDS, 'layers/apis/shared/data/shop-api/validations/contact.schema.ts')
    expect(dto).not.toMatch(/\.min\(|\.max\(/)
  })

  it('are refused on a type that has no length or range, and when min is over max', () => {
    expect(messages([{ name: 'live', type: 'boolean', min: 1 }])).toEqual(['Contact.live: a "boolean" field takes no min or max'])
    expect(messages([{ name: 'status', type: 'select', options: ['a'], max: 3 }])).toEqual(['Contact.status: a "select" field takes no min or max'])
    expect(messages([{ name: 'name', type: 'text', min: 5, max: 2 }])).toEqual(['Contact.name: its min (5) is over its max (2)'])
    expect(messages([{ name: 'name', type: 'text', min: -1 }])).toEqual(['Contact.name: a text\'s min and max are lengths: use 0 or more'])
    expect(messages([{ name: 'name', type: 'text', max: 2.5 }])).toEqual(['Contact.name: a text\'s min and max are lengths: use whole numbers'])
  })

  it('give the generated tests samples within them, so a sent sample passes the check', () => {
    const sample = sampleModel(source([
      { name: 'name', type: 'text', min: 12 },
      { name: 'code', type: 'text', max: 3 },
      { name: 'age', type: 'integer', min: 5.5 },
      { name: 'price', type: 'money', currency: 'EUR', max: 1 },
      { name: 'score', type: 'percent', min: 40, max: 60 }
    ]) as unknown as ApiSource, 'Contact', false)
    expect((sample.name as string).length).toBeGreaterThanOrEqual(12)
    expect((sample.code as string).length).toBeLessThanOrEqual(3)
    expect(sample.age).toBe(6)
    expect(sample.price).toBeLessThanOrEqual(1)
    expect(sample.score).toBe(40)
  })

  it('leave a model without them as it was', () => {
    expect(read([{ name: 'name', type: 'text' }], 'layers/apis/shared/domain/shop-api/entities/contact.ts')).toContain('  name: z.string()\n')
  })
})
