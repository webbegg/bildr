import { describe, expect, it } from 'vitest'
import { loadModel } from '../../../codegen/src/model/load.ts'
import type { Model, PageFile } from '@bildr/codegen/model'
import { apiAutoArgs, apiChoiceOf, apiChoices, apiMissingArgs, apiQueryPages, apiSample, apiUseRows, usedInPagesWords } from '../../src/shared/apiPageUse.ts'
import { blogModelFiles } from '../canvas/fixture.ts'

/** What the editor knows of an API query a page can use (simple data P7b): the choices, the arguments a page can give by itself, and the sample rows the canvas shows. */

const loaded = loadModel(blogModelFiles())
if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
const model: Model = loaded.model
const page = (name: string): PageFile => Object.values(model.modules).flatMap(mod => mod.pages).find(entry => entry.name === name)!

describe('apiChoices', () => {
  it('lists each API query as "<API> · <query>", with whether it answers many rows', () => {
    expect(apiChoices(model).map(choice => [choice.id, choice.label, choice.many])).toEqual([
      ['api:ds_catalog:products', 'catalog · products', true],
      ['api:ds_catalog:product', 'catalog · product', false],
      ['api:ds_weather:forecast', 'weather · forecast', false]
    ])
  })

  it('lists only the queries that answer many rows for a List', () => {
    expect(apiChoices(model, { many: true }).map(choice => choice.label)).toEqual(['catalog · products'])
  })

  it('has nothing without a model, and reads a choice back from its id', () => {
    expect(apiChoices(null)).toEqual([])
    expect(apiChoiceOf(model, 'api:ds_catalog:products')?.params.map(param => param.name)).toEqual(['category', 'locale'])
    expect(apiChoiceOf(model, 'api:ds_catalog:nope')).toBeUndefined()
    expect(apiChoiceOf(model, 'posts')).toBeUndefined()
  })
})

describe('apiAutoArgs', () => {
  it('gives a route parameter of the page to the parameter of the same name', () => {
    const choice = apiChoiceOf(model, 'api:ds_catalog:products')!
    expect(apiAutoArgs(page('shop-catalog'), choice.params)).toEqual({ category: { $route: 'category' } })
  })

  it('gives nothing for a parameter the page has no route parameter of', () => {
    const choice = apiChoiceOf(model, 'api:ds_catalog:products')!
    expect(apiAutoArgs(page('index'), choice.params)).toEqual({})
  })

  it('gives a route parameter to a text, integer or number parameter, never a true-or-false one (the module refuses that)', () => {
    const choice = apiChoiceOf(model, 'api:ds_catalog:product')!
    expect(apiAutoArgs({ ...page('index'), path: '/things/:id' }, choice.params)).toEqual({ id: { $route: 'id' } })
    const params = [
      { name: 'id', in: 'path', type: 'integer' }, { name: 'ratio', in: 'query', type: 'number' }, { name: 'flag', in: 'query', type: 'boolean' }
    ] as typeof choice.params
    expect(apiAutoArgs({ ...page('index'), path: '/things/:id/:ratio/:flag' }, params)).toEqual({ id: { $route: 'id' }, ratio: { $route: 'ratio' } })
  })
})

describe('apiMissingArgs', () => {
  it('names the required parameters with no argument: a path parameter always, a query parameter when it says so', () => {
    const weather = apiChoiceOf(model, 'api:ds_weather:forecast')!
    const catalog = apiChoiceOf(model, 'api:ds_catalog:products')!
    const one = apiChoiceOf(model, 'api:ds_catalog:product')!
    expect(apiMissingArgs(weather.params, {}).map(param => param.name)).toEqual(['city'])
    expect(apiMissingArgs(weather.params, { city: 'Oslo' })).toEqual([])
    expect(apiMissingArgs(catalog.params, {})).toEqual([])
    expect(apiMissingArgs(one.params, {}).map(param => param.name)).toEqual(['id'])
  })
})

describe('apiUseRows', () => {
  it('reads what a use answers: its model and whether it is a list', () => {
    const rows = apiUseRows(model, { datasource: 'ds_catalog', query: 'products' })
    expect(rows?.many).toBe(true)
    expect(rows?.model).toBe('Product')
    expect(apiUseRows(model, { datasource: 'ds_catalog', query: 'nope' })).toBeUndefined()
  })
})

describe('apiSample', () => {
  const rows = (query: string, datasource = 'ds_catalog') => apiUseRows(model, { datasource, query })!

  it('is three rows for a list, each with its model\'s fields as sample values', () => {
    const sample = apiSample(rows('products')) as Array<Record<string, unknown>>
    expect(sample).toHaveLength(3)
    expect(sample[0]).toEqual({
      id: 0,
      name: 'name',
      price: 0,
      inStock: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      note: 'note',
      categories: [{ id: 0, name: 'name' }, { id: 0, name: 'name' }, { id: 0, name: 'name' }]
    })
  })

  it('is one record for a query that answers one', () => {
    expect(apiSample(rows('forecast', 'ds_weather'))).toEqual({ city: 'city', celsius: 0, observedAt: '2026-01-01T00:00:00.000Z' })
  })

  it('stops where a model contains itself', () => {
    const looping = { models: [{ name: 'Node', fields: [{ name: 'label', type: 'text' as const }, { name: 'child', type: 'model' as const, model: 'Node' }] }], model: 'Node', many: false }
    const sample = apiSample(looping) as { child: { child: unknown } }
    expect(sample.child.child).toBeTruthy()
    expect(JSON.stringify(sample).length).toBeLessThan(2000)
  })
})

describe('apiQueryPages', () => {
  it('names the pages that read a query, once each, from the module\'s usage', () => {
    expect(apiQueryPages(model, 'ds_catalog', 'products')).toEqual(['shop-catalog'])
    expect(apiQueryPages(model, 'ds_weather', 'forecast')).toEqual(['weather'])
    expect(apiQueryPages(model, 'ds_catalog', 'product')).toEqual([])
  })

  it('counts a page once however many ways it reads the query', () => {
    const shop = structuredClone(model)
    const catalog = Object.values(shop.modules).flatMap(mod => mod.pages).find(entry => entry.name === 'shop-catalog')!
    catalog.uses!.apis!.push({ as: 'more', datasource: 'ds_catalog', query: 'products' })
    expect(apiQueryPages(shop, 'ds_catalog', 'products')).toEqual(['shop-catalog'])
  })
})

describe('usedInPagesWords', () => {
  it('says where, naming a few pages and counting the rest', () => {
    expect(usedInPagesWords(['a'])).toBe('Used in a')
    expect(usedInPagesWords(['a', 'b', 'c'])).toBe('Used in a, b, c')
    expect(usedInPagesWords(['a', 'b', 'c', 'd', 'e'])).toBe('Used in a, b, c and 2 more')
  })
})
