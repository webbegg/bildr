// Simple data P4 (S4, S6): the models an API sample call suggests, as `api_model_set` takes them.
import { describe, expect, it } from 'vitest'
import { apiProblems } from '../../src/model/schemas'
import { inferApiModels } from '../../src/edit/index'

const valid = (models: ReturnType<typeof inferApiModels>) =>
  apiProblems({ baseUrl: 'https://x.example.com', env: { baseUrl: 'NUXT_X' }, runtime: 'server', models, queries: [], actions: [] })

describe('inferApiModels', () => {
  it('turns an object into a model: camelCase names, the remote key when it differs, types from values', () => {
    const models = inferApiModels({
      id: 7, full_name: 'Ada', score: 9.5, active: true, born: '1815-12-10', seen: '2026-01-01T10:00:00Z',
      ref: '6f1c2d3e-4b5a-4c6d-8e7f-000000000001', avatar: 'https://x.example.com/a.png',
      mail: 'ada@example.com', site: 'https://ada.example.com/about', tint: '#33aa99', label: 'a #1 pick'
    }, 'product')
    expect(models).toEqual([{
      name: 'Product',
      fields: [
        { name: 'id', type: 'integer' },
        { name: 'fullName', type: 'text', key: 'full_name' },
        { name: 'score', type: 'number' },
        { name: 'active', type: 'boolean' },
        { name: 'born', type: 'date' },
        { name: 'seen', type: 'datetime' },
        { name: 'ref', type: 'uuid' },
        // Field types S2: what a SaaS type's check takes is that type.
        { name: 'avatar', type: 'image' },
        { name: 'mail', type: 'email' },
        { name: 'site', type: 'url' },
        { name: 'tint', type: 'color' },
        { name: 'label', type: 'text' }
      ]
    }])
    expect(valid(models)).toEqual([])
  })

  it('keeps text when an item has an empty value, which a SaaS type\'s check refuses (verify B1)', () => {
    const models = inferApiModels([
      { mail: 'ana@example.com', site: 'https://ana.dev', avatar: 'https://x.com/a.png', brand: '#336699' },
      { mail: '', site: '', avatar: '', brand: '' }
    ], 'contact')
    expect(models[0]!.fields.map(field => field.type)).toEqual(['text', 'text', 'text', 'text'])
  })

  it('proposes a url only for http(s)://, a color only for hex with a letter or a color key, and never types an id as a url (verify A3)', () => {
    const types = (sample: Record<string, unknown>) => inferApiModels(sample, 'r')[0]!.fields.map(field => `${field.name}:${field.type}`)
    expect(types({ a: 'http:a.com', b: 'https:/a.com', c: 'https:a.com/x.png', avatar: 'https:/x.com/a.png' })).toEqual(['a:text', 'b:text', 'c:text', 'avatar:text'])
    expect(types({ ref: '#123', issue: '#456789', tint: '#123', hex: '#33aa99' })).toEqual(['ref:text', 'issue:text', 'tint:color', 'hex:color'])
    expect(types({ id: 'https://x.org/1' })).toEqual(['id:text'])
  })

  it('keeps text when one of the values does not fit a SaaS type (field types S2)', () => {
    const models = inferApiModels([{ mail: 'ada@example.com', site: 'https://x.example.com' }, { mail: 'not an email', site: 'ftp://x.example.com' }], 'person')
    expect(models[0]!.fields).toEqual([{ name: 'mail', type: 'text' }, { name: 'site', type: 'text' }])
  })

  it('reads up to 20 items of an array: nullable on null, optional on a missing key', () => {
    const items = [
      { id: 1, note: null, nick: 'a', price: 1 },
      { id: 2, note: 'x', price: 2.5 },
      { id: 3, note: 'y', nick: 'c', price: 3 }
    ]
    const [model] = inferApiModels(items, 'Item')
    expect(model!.fields).toEqual([
      { name: 'id', type: 'integer' },
      { name: 'note', type: 'text', nullable: true },
      { name: 'nick', type: 'text', optional: true },
      { name: 'price', type: 'number' }
    ])
  })

  it('does not look past the 20th item', () => {
    const items = [...Array.from({ length: 20 }, () => ({ id: 1 })), { id: 1, late: true }]
    expect(inferApiModels(items, 'Row').at(-1)!.fields.map(field => field.name)).toEqual(['id'])
  })

  it('makes nested objects models (root first) and lists of objects or scalars lists', () => {
    const models = inferApiModels({
      id: 1,
      address: { city: 'London', geo: { lat: 1.5, lng: 2.5 } },
      lines: [{ sku: 'a', qty: 1 }, { sku: 'b', qty: 2 }],
      tags: ['a', 'b'],
      scores: [1, 2],
      empty: []
    }, 'order')
    // In the order api_model_set takes them (verify P4): a model after every model it names, the root last.
    expect(models.map(model => model.name)).toEqual(['Lines', 'Geo', 'Address', 'Order'])
    expect(models[3]!.fields).toEqual([
      { name: 'id', type: 'integer' },
      { name: 'address', type: 'model', model: 'Address' },
      { name: 'lines', type: 'model', model: 'Lines', list: true },
      { name: 'tags', type: 'text', list: true },
      { name: 'scores', type: 'integer', list: true },
      { name: 'empty', type: 'text', list: true }
    ])
    expect(models[2]!.fields).toEqual([{ name: 'city', type: 'text' }, { name: 'geo', type: 'model', model: 'Geo' }])
    expect(valid(models)).toEqual([])
  })

  it('keeps model names Pascal and unique, and never makes a cycle', () => {
    const models = inferApiModels({ 'user': { user: { user: { id: 1 } } }, 'other': { user: { id: 2 } }, 'order-line': { id: 3 } }, 'user')
    const names = models.map(model => model.name)
    expect(new Set(names).size).toBe(names.length)
    for (const name of names) expect(name).toMatch(/^[A-Z][A-Za-z0-9]*$/)
    expect(names.at(-1)).toBe('User')
    expect(valid(models)).toEqual([])
  })

  it('keeps field names unique when keys collapse to the same name', () => {
    const [model] = inferApiModels({ 'full_name': 'a', 'fullName': 'b', 'full-name': 'c' }, 'p')
    const names = model!.fields.map(field => field.name)
    expect(new Set(names).size).toBe(3)
    expect(valid([model!])).toEqual([])
  })

  it('has nothing to say about a sample with no object', () => {
    expect(inferApiModels(5, 'x')).toEqual([])
    expect(inferApiModels([], 'x')).toEqual([])
    expect(inferApiModels([1, 2], 'x')).toEqual([])
    expect(inferApiModels({}, 'x')).toEqual([])
  })

  it('keeps a root name that is already a model name (review P4)', () => {
    expect(inferApiModels({ id: 1 }, 'URLList').at(-1)!.name).toBe('URLList')
    expect(inferApiModels({ id: 1 }, 'HTTPError').at(-1)!.name).toBe('HTTPError')
    expect(inferApiModels({ id: 1 }, 'order-line').at(-1)!.name).toBe('OrderLine')
  })

  it('proposes at most 30 models (review P4)', () => {
    const wide = Object.fromEntries(Array.from({ length: 50 }, (_, index) => [`k${index}`, { a: { b: { c: 1 } } }]))
    const models = inferApiModels(wide, 'root')
    expect(models.length).toBeLessThanOrEqual(30)
    expect(models.at(-1)!.name).toBe('Root')
    expect(valid(models)).toEqual([])
  })
})
