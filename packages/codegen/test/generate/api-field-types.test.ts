// Field types S1: an API model's field can be an email, a url, an image, a phone, a color, money (in a currency), a percent or one of a
// list of options (select). Each has its own check in the generated zod, its TS type, and a sample the generated tests take. The model
// file says what a type needs (a select's options, money's currency), and the load refuses what does not fit.
import { describe, expect, it } from 'vitest'
import { generate } from '../../src/generate/index'
import { loadModel } from '../../src/model/load'
import { sampleModel } from '../../src/generate/api-model'
import { fixtureModelFiles } from '../model/fixture'

const FILE = '.bildr/datasources/shop-api.json'
const CONTACT = {
  name: 'Contact',
  fields: [
    { name: 'mail', type: 'email' },
    { name: 'site', type: 'url', optional: true },
    { name: 'avatar', type: 'image', nullable: true },
    { name: 'phone', type: 'phone' },
    { name: 'tint', type: 'color' },
    { name: 'price', type: 'money', currency: 'EUR' },
    { name: 'discount', type: 'percent' },
    { name: 'status', type: 'select', options: ['draft', 'live', 'it\'s off'] },
    { name: 'tags', type: 'select', options: ['a', 'b'], list: true }
  ]
}
const source = (models: unknown[]) => ({
  id: 'ds_shop_api',
  name: 'shop-api',
  kind: 'api',
  env: { baseUrl: 'NUXT_APIS_SHOP_API_BASE_URL' },
  baseUrl: 'https://x.example.com/v1',
  runtime: 'server',
  models,
  queries: [{ name: 'contacts', path: '/contacts', params: [], result: { model: models.length ? 'Contact' : 'X', many: true } }],
  actions: []
})
const load = (models: unknown[]) => loadModel({ ...fixtureModelFiles(), [FILE]: JSON.stringify(source(models)) })
const messages = (fields: unknown[]) => {
  const loaded = load([{ name: 'Contact', fields }])
  return loaded.ok ? [] : loaded.problems.map(problem => problem.message.replace(/^[\w.[\]]+: /, ''))
}
const generated = () => {
  const loaded = load([CONTACT])
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
  return generate(loaded.model)
}
const read = (path: string) => generated().find(file => file.path === path)!.content

describe('an API model field of a SaaS type', () => {
  it('loads with its settings', () => {
    expect(load([CONTACT]).ok).toBe(true)
  })

  it('refuses a select without options, with an empty or a repeated option, and options on another type', () => {
    expect(messages([{ name: 'status', type: 'select' }])).toEqual(['Contact.status is a "select" field: list its options'])
    expect(messages([{ name: 'status', type: 'select', options: [] }])).toEqual(['Contact.status is a "select" field: list its options'])
    expect(messages([{ name: 'status', type: 'select', options: ['a', 'a'] }])).toEqual(['Contact.status: the option "a" is listed twice'])
    expect(messages([{ name: 'status', type: 'select', options: [''] }])).not.toEqual([])
    expect(messages([{ name: 'status', type: 'text', options: ['a'] }])).toEqual(['Contact.status: Only a "select" field lists options'])
  })

  it('refuses money without a currency code, a code that is not three capitals, and a currency on another type', () => {
    expect(messages([{ name: 'price', type: 'money' }])).toEqual(['Contact.price is a "money" field: give its currency, like "EUR"'])
    expect(messages([{ name: 'price', type: 'money', currency: 'euro' }])).not.toEqual([])
    expect(messages([{ name: 'price', type: 'number', currency: 'EUR' }])).toEqual(['Contact.price: Only a "money" field has a currency'])
  })

  it('types the DTO: strings, numbers, and a select as the union of its options', () => {
    expect(read('layers/apis/shared/infrastructure/shop-api/models/contact.dto.ts')).toContain([
      'export interface ContactDto {',
      '  mail: string',
      '  site?: string',
      '  avatar: string | null',
      '  phone: string',
      '  tint: string',
      '  /** Money, in EUR. */',
      '  price: number',
      '  discount: number',
      '  status: \'draft\' | \'live\' | \'it\\\'s off\'',
      '  tags: Array<\'a\' | \'b\'>',
      '}'
    ].join('\n'))
  })

  it('checks each type in the DTO schema and the entity', () => {
    const lines = [
      '  mail: z.email(),',
      '  site: z.url({ protocol: /^https?$/ }).optional(),',
      '  avatar: z.url({ protocol: /^https?$/ }).nullable(),',
      '  phone: z.string().regex(/^\\+?[\\d\\s().-]{5,24}$/),',
      '  tint: z.string().regex(/^#(?:[\\da-fA-F]{3}|[\\da-fA-F]{6}|[\\da-fA-F]{8})$/),',
      '  price: z.number(),',
      '  discount: z.number(),',
      '  status: z.enum([\'draft\', \'live\', \'it\\\'s off\']),',
      '  tags: z.array(z.enum([\'a\', \'b\']))'
    ].join('\n')
    expect(read('layers/apis/shared/infrastructure/shop-api/validations/contact.schema.ts')).toContain(lines)
    expect(read('layers/apis/shared/domain/shop-api/entities/contact.ts')).toContain(lines)
  })

  it('has samples each check takes', () => {
    const loaded = load([CONTACT])
    if (!loaded.ok) throw new Error('not loaded')
    const api = loaded.model.datasources.find(entry => entry.id === 'ds_shop_api')!
    expect(sampleModel(api as never, 'Contact', true)).toEqual({
      mail: 'mail@example.com',
      site: 'https://example.com/site',
      avatar: 'https://example.com/avatar.png',
      phone: '+1 555 0100',
      tint: '#336699',
      price: 9.99,
      discount: 25,
      status: 'draft',
      tags: ['a']
    })
  })
})
