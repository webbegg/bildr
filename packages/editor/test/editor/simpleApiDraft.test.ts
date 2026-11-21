import { describe, expect, it } from 'vitest'
import type { ApiSource } from '@bildr/codegen/edit'
import type { ApiModel } from '@bildr/codegen/model'
import { readPastedRequest } from '../../src/shared/requestPaste.ts'
import { applyPastedRequest, clashesOf, newParam, operationDirty, operationDraftOf, paramsOutput, planProposal, queryOutput, renameProblem, settingsInput, settingsRebase, settingsOf, tryParams } from '../../src/editor/simpleApiDraft.ts'
import { baseUrlProblem, listShown, modelNameOf, operationNameOf, pathParamNames, secretVarAfterRename } from '../../src/shared/simpleApi.ts'

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

describe('a request pasted into the path', () => {
  const stored = { name: 'products', path: '/products', params: [{ name: 'lang', in: 'query', type: 'text', key: 'l' }], result: { model: 'Product', many: true } } as never
  const read = (text: string) => {
    const result = readPastedRequest(text, 'https://api.example.com/v1')
    if (!result?.ok) throw new Error('not read')
    return result.request
  }

  it('sets the path, adds a query parameter per new key (its remote key when the name differs) and gives each its value to try', () => {
    const draft = operationDraftOf('query', stored)
    const applied = applyPastedRequest(draft, read('https://api.example.com/v1/items/:id?per_page=20&l=fr&lang=de'))
    expect(draft.path).toBe('/items/:id')
    expect(paramsOutput(draft)).toEqual([
      { name: 'id', in: 'path', type: 'text' },
      { name: 'lang', in: 'query', type: 'text', key: 'l' },
      { name: 'perPage', in: 'query', type: 'integer', key: 'per_page' },
      { name: 'lang2', in: 'query', type: 'text', key: 'lang' }
    ])
    expect(applied.values).toEqual({ perPage: '20', lang: 'fr', lang2: 'de' })
    expect(applied.filled).toBe('Filled in from the URL: the path and 3 query parameters.')
    expect(applied.notes).toEqual([])
  })

  it('sets an action\'s method and gives its body to try', () => {
    const draft = operationDraftOf('action', null)
    const applied = applyPastedRequest(draft, read(`curl -X PUT https://api.example.com/v1/items/1 -d '{"a":1}'`))
    expect(draft.method).toBe('PUT')
    expect(draft.path).toBe('/items/1')
    expect(applied.body).toBe('{\n  "a": 1\n}')
    expect(applied.filled).toBe('Filled in from the cURL command: the method, the path and the body to try.')
  })

  it('keeps the method when it is not one the query or action can have, and says so', () => {
    const action = operationDraftOf('action', null)
    expect(applyPastedRequest(action, read('https://api.example.com/v1/items')).notes).toEqual(['It is a GET: it only reads, so make it a query. Only its path and parameters were used.'])
    expect(action.method).toBe('POST')
    const query = operationDraftOf('query', null)
    const applied = applyPastedRequest(query, read(`curl -X DELETE https://api.example.com/v1/items/1`))
    expect(applied.notes).toEqual(['It is a DELETE: it can change data, so make it an action. Only its path and parameters were used.'])
    expect(applied.body).toBeUndefined()
    expect(query.path).toBe('/items/1')
  })

  it('gives a yes / no parameter its value as a yes or a no', () => {
    const draft = operationDraftOf('query', null)
    expect(applyPastedRequest(draft, read('https://api.example.com/v1/items?draft=true')).values).toEqual({ draft: true })
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

describe('trying again after some of the models were set', () => {
  const oldMaker: ApiModel = { name: 'Maker', fields: [{ name: 'title', type: 'text' }] }
  const maker: ApiModel = { name: 'Maker', fields: [{ name: 'name', type: 'text' }] }
  const gadget: ApiModel = { name: 'Gadget', fields: [{ name: 'maker', type: 'model', model: 'Maker' }] }
  /** What the first try left: Maker kept as Maker2. */
  const after: ApiModel[] = [oldMaker, { name: 'Maker2', fields: maker.fields }]
  const kept = { Maker: { how: 'rename', name: 'Maker2' } } as const

  it('does not ask again about a model that was set under the name the user chose', () => {
    expect(clashesOf([maker, gadget], after)).toEqual(['Maker'])
    expect(clashesOf([maker, gadget], after, kept)).toEqual([])
  })

  it('finds that a model whose fields name a renamed model is the one already set', () => {
    const done: ApiModel[] = [...after, { name: 'Gadget', fields: [{ name: 'maker', type: 'model', model: 'Maker2' }] }]
    expect(clashesOf([maker, gadget], done)).toEqual(['Maker', 'Gadget'])
    expect(clashesOf([maker, gadget], done, kept)).toEqual([])
    expect(planProposal([maker, gadget], done, kept)).toEqual({ models: [], root: 'Gadget' })
  })

  it('sends only what is not there yet', () => {
    const plan = planProposal([maker, gadget], after, kept)
    expect(plan.models).toEqual([{ name: 'Gadget', fields: [{ name: 'maker', type: 'model', model: 'Maker2' }] }])
  })

  it('does not call a new name taken when the model that has it says what the proposed one says', () => {
    expect(renameProblem([maker, gadget], after, kept)).toBe('')
    expect(renameProblem([maker, gadget], [oldMaker, { name: 'Maker2', fields: [{ name: 'other', type: 'text' }] }], kept)).toBe('“Maker2” is taken too: pick another name')
  })

  it('still refuses an empty name, a name the proposal has and two models given one name', () => {
    expect(renameProblem([maker, gadget], [oldMaker], { Maker: { how: 'rename', name: '' } })).toBe('Give the new name of “Maker”')
    expect(renameProblem([maker, gadget], [oldMaker], { Maker: { how: 'rename', name: 'Gadget' } })).toBe('“Gadget” is taken too: pick another name')
    expect(renameProblem([maker, gadget], [oldMaker, { name: 'Gadget', fields: [] }], { Maker: { how: 'rename', name: 'Maker2' }, Gadget: { how: 'rename', name: 'Maker2' } })).toBe('“Maker2” is taken too: pick another name')
    expect(renameProblem([maker, gadget], [oldMaker], { Maker: { how: 'replace' } })).toBe('')
  })
})

describe('what Try it says of a list', () => {
  it('counts what is shown of a list the answer was cut to', () => {
    const json = { data: { items: [1, 2, 3] }, total: 30 }
    expect(listShown(json, 'data.items')).toBe(3)
    expect(listShown([1, 2], '')).toBe(2)
    expect(listShown(json, 'nothing')).toBeUndefined()
  })
})

describe('the secret of an API that is renamed', () => {
  const signed = { name: 'shop-api', env: { baseUrl: 'NUXT_APIS_SHOP_API_BASE_URL', apiKey: 'NUXT_APIS_SHOP_API_API_KEY' }, auth: { type: 'bearer', secret: 'apiKey' } } as unknown as ApiSource

  it('names the variable the module will give it, from the name as the module makes it', () => {
    expect(secretVarAfterRename(signed, 'Shop Two')).toBe('NUXT_APIS_SHOP_TWO_API_KEY')
    expect(secretVarAfterRename(signed, ' shop-api ')).toBeUndefined()
    expect(secretVarAfterRename(signed, '   ')).toBeUndefined()
  })

  it('says nothing for a variable the user named, or an API with no secret', () => {
    expect(secretVarAfterRename({ ...signed, env: { apiKey: 'MY_SECRET' } } as unknown as ApiSource, 'Shop Two')).toBeUndefined()
    expect(secretVarAfterRename({ ...signed, auth: undefined, env: {} } as unknown as ApiSource, 'Shop Two')).toBeUndefined()
  })
})
