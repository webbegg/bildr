import { describe, expect, it } from 'vitest'
import type { ApiSource } from '@bildr/codegen/edit'
import type { ApiModel } from '@bildr/codegen/model'
import { clashesOf, newParam, operationDirty, operationDraftOf, paramsOutput, planProposal, queryOutput, settingsInput, settingsRebase, settingsOf, tryParams } from '../../src/editor/simpleApiDraft.ts'
import { baseUrlProblem, modelNameOf, operationNameOf, pathParamNames } from '../../src/shared/simpleApi.ts'

/** The API drafts' pure parts (simple data, S4, S6): what each form would write, what counts as an edit, and what using an answer does to the models. */

const source = {
  id: 'ds_shop', name: 'shop', kind: 'api', baseUrl: 'https://api.example.com', runtime: 'server', env: {}, models: [], queries: [], actions: []
} as unknown as ApiSource

describe('names and paths', () => {
  it('reads the path parameters from the :name segments, once each, in order', () => {
    expect(pathParamNames('/categories/:category/items/:item')).toEqual(['category', 'item'])
    expect(pathParamNames('/products')).toEqual([])
    expect(pathParamNames('/a/:id/b/:id')).toEqual(['id'])
  })

  it('names models and operations as the module wants, from the words typed', () => {
    expect(modelNameOf('order line')).toBe('OrderLine')
    expect(operationNameOf('List products')).toBe('listProducts')
    expect(operationNameOf('  ')).toBe('')
  })

  it('says why a base URL is refused with the module\'s words, and nothing for a good one or an empty one', () => {
    expect(baseUrlProblem('')).toBeUndefined()
    expect(baseUrlProblem('https://api.example.com/v1')).toBeUndefined()
    expect(baseUrlProblem('api.example.com')).toContain('is not an absolute URL')
    expect(baseUrlProblem('ftp://x.com')).toBe('A base URL is http or https')
  })
})

describe('the settings draft', () => {
  it('writes only what changed, and null for no sign-in', () => {
    const base = settingsOf(source)
    expect(settingsInput(base, source)).toBeNull()
    expect(settingsInput({ ...base, baseUrl: 'https://x.com ' }, source)).toEqual({ baseUrl: 'https://x.com' })
    expect(settingsInput({ ...base, signIn: 'header', header: 'X-Key' }, source)).toEqual({ auth: { type: 'header', header: 'X-Key' } })
    expect(settingsInput({ ...base, signIn: 'bearer' }, source)).toEqual({ auth: { type: 'bearer' } })
    const signed = { ...source, auth: { type: 'bearer', secret: 'apiKey' } } as ApiSource
    expect(settingsInput({ ...settingsOf(signed), signIn: 'none' }, signed)).toEqual({ auth: null })
  })

  it('keeps what was touched over a changed API and takes the new value of what was not', () => {
    const base = source
    const stored = { ...source, baseUrl: 'https://new.example.com', name: 'renamed' } as ApiSource
    const draft = { ...settingsOf(base), name: 'mine' }
    expect(settingsRebase(draft, base, stored)).toEqual({ ...settingsOf(stored), name: 'mine' })
  })
})

describe('the operation draft', () => {
  const stored = { name: 'productById', path: '/products/:id', params: [{ name: 'id', in: 'path', type: 'integer' }, { name: 'lang', in: 'query', type: 'text', key: 'l' }], result: { model: 'Product', many: false } } as never

  it('round-trips a saved query: no edits, and the same query written', () => {
    const draft = operationDraftOf('query', stored)
    expect(operationDirty(draft, stored)).toBe(false)
    expect(queryOutput('productById', draft)).toEqual(stored)
  })

  it('follows the path for its path parameters, keeping the type given to one', () => {
    const draft = operationDraftOf('query', stored)
    draft.path = '/shops/:shop/products/:id'
    expect(paramsOutput(draft).map(param => `${param.in}:${param.name}:${param.type}`)).toEqual(['path:shop:text', 'path:id:integer', 'query:lang:text'])
    expect(operationDirty(draft, stored)).toBe(true)
  })

  it('leaves out a parameter with no name, and writes required and the key only when set', () => {
    const draft = operationDraftOf('query', null)
    draft.path = '/search'
    draft.params = [newParam(), { ...newParam(), name: 'term', required: true, remote: 'q' }]
    expect(paramsOutput(draft)).toEqual([{ name: 'term', in: 'query', type: 'text', required: true, key: 'q' }])
  })

  it('sends the values for api_try by the key the API calls each, as the types say, leaving out the empty ones', () => {
    const draft = operationDraftOf('query', stored)
    expect(tryParams(draft, { id: '7', lang: 'en' })).toEqual({ id: 7, l: 'en' })
    expect(tryParams(draft, { id: '7', lang: '' })).toEqual({ id: 7 })
    const flag = operationDraftOf('query', null)
    flag.params = [{ ...newParam(), name: 'draft', type: 'boolean' }]
    expect(tryParams(flag, { draft: true })).toEqual({ draft: true })
  })
})

describe('using a proposed answer', () => {
  const existing: ApiModel[] = [{ name: 'Product', fields: [{ name: 'id', type: 'integer' }] }]
  const maker: ApiModel = { name: 'Maker', fields: [{ name: 'name', type: 'text' }] }
  const product: ApiModel = { name: 'Product', fields: [{ name: 'maker', type: 'model', model: 'Maker' }] }

  it('finds the models that clash with an existing one, and not the ones that say the same', () => {
    expect(clashesOf([maker, product], existing)).toEqual(['Product'])
    expect(clashesOf([{ name: 'Product', fields: [{ name: 'id', type: 'integer' }] }], existing)).toEqual([])
  })

  it('keeps the listed order, and root last', () => {
    const plan = planProposal([maker, product], [], {})
    expect(plan.models.map(model => model.name)).toEqual(['Maker', 'Product'])
    expect(plan.root).toBe('Product')
  })

  it('leaves out a model that already says the same, and keeps it as the root', () => {
    const plan = planProposal([{ name: 'Product', fields: [{ name: 'id', type: 'integer' }] }], existing, {})
    expect(plan.models).toEqual([])
    expect(plan.root).toBe('Product')
  })

  it('renames a clashing model, and every field that names it follows', () => {
    const wrapper: ApiModel = { name: 'Page', fields: [{ name: 'items', type: 'model', model: 'Product', list: true }] }
    const plan = planProposal([product, wrapper], [...existing, maker], { Product: { how: 'rename', name: 'ProductV2' } })
    expect(plan.models.map(model => model.name)).toEqual(['ProductV2', 'Page'])
    expect(plan.models[1]!.fields[0]!.model).toBe('ProductV2')
    expect(plan.root).toBe('Page')
  })

  it('replaces a clashing model by sending it under its name', () => {
    const plan = planProposal([product], existing, { Product: { how: 'replace' } })
    expect(plan.models).toEqual([product])
  })
})
