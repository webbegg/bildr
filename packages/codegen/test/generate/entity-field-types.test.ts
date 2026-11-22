// Field types S3: entities and stores take the SaaS types API models have (email, url, phone, color, money, percent, select), from the
// same catalogue. Each gets its check in the generated zod, its SQLite column (a number for money and percent, text for the others) and
// its TS type; a select lists its options, money names its currency, and the load and the edits refuse what does not fit.
import { describe, expect, it } from 'vitest'
import { applyEdit } from '../../src/edit/index'
import type { EditName } from '../../src/edit/index'
import { generate } from '../../src/generate/index'
import { loadModel } from '../../src/model/load'
import { applyChanges } from '../edit/helpers'
import { fixtureModelFiles } from '../model/fixture'

const FIELDS = [
  { name: 'mail', type: 'email', required: true },
  { name: 'site', type: 'url' },
  { name: 'phone', type: 'phone' },
  { name: 'tint', type: 'color' },
  { name: 'price', type: 'money', currency: 'EUR', required: true },
  { name: 'discount', type: 'percent' },
  { name: 'stage', type: 'select', options: ['lead', 'won', 'it\'s lost'], required: true }
]

const edit = (files: Record<string, string>, name: EditName, input: unknown) => {
  const outcome = applyEdit(files, name, input)
  if (!outcome.ok) throw new Error(`${name}: ${JSON.stringify(outcome)}`)
  return applyChanges(files, outcome.changes)
}
const refusal = (files: Record<string, string>, name: EditName, input: unknown) => {
  const outcome = applyEdit(files, name, input)
  return outcome.ok ? 'applied' : outcome.message
}
const withDeals = () => edit(fixtureModelFiles(), 'entity_create', { name: 'deal', source: 'ds_main', fields: FIELDS })
const generated = (files: Record<string, string>) => {
  const loaded = loadModel(files)
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
  return Object.fromEntries(generate(loaded.model).map(file => [file.path, file.content]))
}
const ENTITY = '.bildr/modules/blog/entities/deal.json'
const entityLoad = (fields: unknown[]) => {
  const files = withDeals()
  const entity = JSON.parse(files[ENTITY]!)
  const loaded = loadModel({ ...files, [ENTITY]: JSON.stringify({ ...entity, fields: [entity.fields[0], ...fields] }) })
  return loaded.ok ? [] : loaded.problems.map(problem => problem.message)
}

describe('an entity\'s SaaS field types (field types S3)', () => {
  it('generates each type\'s check, a select as the enum of its options', () => {
    const domain = generated(withDeals())['layers/blog/shared/domain/deal.ts']!
    expect(domain).toContain('mail: z.email()')
    expect(domain).toContain('site: z.url({ protocol: /^https?$/ }).optional()')
    expect(domain).toContain('phone: z.string().regex(')
    expect(domain).toContain('tint: z.string().regex(')
    expect(domain).toContain('price: z.number()')
    expect(domain).toContain('discount: z.number().optional()')
    expect(domain).toContain('stage: z.enum([\'lead\', \'won\', \'it\\\'s lost\'])')
  })

  it('stores money and a percent as numbers and the others as text', () => {
    const schema = generated(withDeals())['layers/blog/server/infrastructure/db/schema.ts']!
    expect(schema).toContain('price: real(\'price\').notNull()')
    expect(schema).toContain('discount: real(\'discount\')')
    expect(schema).toContain('mail: text(\'mail\').notNull()')
    expect(schema).toContain('stage: text(\'stage\', { enum: [\'lead\', \'won\', \'it\\\'s lost\'] }).notNull()')
  })

  // That the old types generate what they did (an image is still any text) is the golden fixture's test (generate.test.ts).

  it('refuses a select with no options, an option twice, money with no currency and settings a type does not take', () => {
    expect(entityLoad([{ id: 'fld_stage', name: 'stage', type: 'select' }]).join('\n')).toContain('list its options')
    expect(entityLoad([{ id: 'fld_stage', name: 'stage', type: 'select', options: ['a', 'a'] }]).join('\n')).toContain('the option "a" is listed twice')
    expect(entityLoad([{ id: 'fld_price', name: 'price', type: 'money' }]).join('\n')).toContain('give its currency')
    expect(entityLoad([{ id: 'fld_note', name: 'note', type: 'text', options: ['a'] }]).join('\n')).toContain('Only a "select" field lists options')
    expect(entityLoad([{ id: 'fld_note', name: 'note', type: 'text', currency: 'EUR' }]).join('\n')).toContain('Only a "money" field has a currency')
    expect(entityLoad([{ id: 'fld_stage', name: 'stage', type: 'select', options: ['a'], pattern: '^a$' }]).join('\n')).toContain('A "select" field takes no min, max or pattern')
  })

  it('adds a field with its options or currency, and refuses a select default that is not an option', () => {
    const files = edit(withDeals(), 'entity_field_add', { entity: 'ent_deal', name: 'size', type: 'select', options: ['s', 'm'] })
    expect(JSON.parse(files[ENTITY]!).fields.at(-1)).toEqual({ id: 'fld_size', name: 'size', type: 'select', options: ['s', 'm'] })
    expect(refusal(withDeals(), 'entity_field_add', { entity: 'ent_deal', name: 'size', type: 'select' })).toContain('list its options')
    expect(refusal(withDeals(), 'entity_field_add', { entity: 'ent_deal', name: 'fee', type: 'money' })).toContain('give its currency')
  })

  it('changes a field\'s type: a select takes options, the old settings go, and a sample row that is not an option is refused', () => {
    let files = edit(withDeals(), 'entity_field_update', { entity: 'ent_deal', field: 'fld_stage', type: 'text' })
    expect(JSON.parse(files[ENTITY]!).fields.find((field: { name: string }) => field.name === 'stage')).toEqual({ id: 'fld_stage', name: 'stage', type: 'text', required: true })
    files = edit(files, 'entity_field_update', { entity: 'ent_deal', field: 'fld_stage', type: 'select', options: ['a', 'b'] })
    expect(JSON.parse(files[ENTITY]!).fields.find((field: { name: string }) => field.name === 'stage').options).toEqual(['a', 'b'])
    const seeded = { ...files, '.bildr/modules/blog/fixtures/deal.json': JSON.stringify({ entity: 'ent_deal', rows: [{ mail: 'a@example.com', price: 1, stage: 'a' }] }) }
    expect(refusal(seeded, 'entity_field_update', { entity: 'ent_deal', field: 'fld_stage', options: ['b', 'c'] })).toContain('Sample row 1 has stage "a", which is not one of b, c')
  })
})

describe('a store\'s SaaS field types (field types S3)', () => {
  it('takes a select with a default among its options and money with its currency', () => {
    const files = edit(fixtureModelFiles(), 'state_create', { name: 'filters', fields: [{ name: 'stage', type: 'select', options: ['open', 'won'], default: 'open' }, { name: 'budget', type: 'money', currency: 'USD', default: 10 }] })
    const store = generated(files)['layers/blog/app/data/filters.collection.ts']!
    expect(store).toContain('z.enum([\'open\', \'won\'])')
    expect(refusal(fixtureModelFiles(), 'state_create', { name: 'filters', fields: [{ name: 'stage', type: 'select', options: ['open'], default: 'shut' }] })).toMatch(/stage.*shut/)
  })
})
