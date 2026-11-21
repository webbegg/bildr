import { describe, expect, it } from 'vitest'
import { apiParamAcceptsStateField } from '../../src/edit/index'
import { project } from './helpers'

/**
 * Review P7 (R3, S1): a List repeats only over a list answer of an API query (W1), and a route parameter fills an integer or number
 * parameter (S1), as every other write of a page use is checked: by the module, with a plain message.
 */
const SHOP = 'ds_shop'

const shop = () => {
  const p = project()
  p.edit('api_create', { name: 'shop', baseUrl: 'https://shop.example.com/v1' })
  p.edit('api_model_set', { datasource: SHOP, model: { name: 'Product', fields: [{ name: 'id', type: 'integer' }, { name: 'title', type: 'text' }, { name: 'tags', type: 'text', list: true }] } })
  p.edit('api_query_set', { datasource: SHOP, query: { name: 'products', path: '/products', params: [], result: { model: 'Product', many: true } } })
  p.edit('api_query_set', { datasource: SHOP, query: { name: 'product', path: '/products/:id', params: [{ name: 'id', in: 'path', type: 'integer' }], result: { model: 'Product', many: false } } })
  p.edit('api_query_set', { datasource: SHOP, query: { name: 'rate', path: '/rate/:id', params: [{ name: 'id', in: 'path', type: 'integer' }, { name: 'score', in: 'query', type: 'number' }, { name: 'flag', in: 'query', type: 'boolean' }], result: { model: 'Product', many: false } } })
  p.edit('page_use_add', { page: 'pg_index', as: 'products', api: { datasource: SHOP, query: 'products' } })
  p.edit('page_use_add', { page: 'pg_index', as: 'first', api: { datasource: SHOP, query: 'product' }, args: { id: 1 } })
  return p
}

/** The quotes List repeats over the products, its text reading `product.title`. */
const bindQuotes = (p: ReturnType<typeof shop>) => {
  p.edit('node_update_props', { file: 'pg_index', nodeId: 'n_quote', props: { text: 'Quote' } })
  p.edit('node_update_props', { file: 'pg_index', nodeId: 'n_quotes', props: { items: { $bind: 'products' }, as: 'product' } })
  p.edit('node_update_props', { file: 'pg_index', nodeId: 'n_quote', props: { text: { $template: '{product.title}' } } })
}

const items = (p: ReturnType<typeof shop>, value: unknown) => p.refuse('node_update_props', { file: 'pg_index', nodeId: 'n_quotes', props: { items: value } }, 'invalid').message

describe('W1: a List repeats only over a list answer', () => {
  it('refuses items bound to a query that answers one record, or to a field of an answer', () => {
    const p = shop()
    expect(items(p, { $bind: 'first' })).toBe('"first" is one record, not a list: the query "product" of the API "shop" answers one. A List repeats over a query that answers a list')
    expect(items(p, { $bind: 'first.tags' })).toBe('"first.tags" is a field of an API answer: a List repeats over the whole answer of a query that answers a list')
    expect(items(p, { $bind: 'products.tags' })).toBe('"products.tags" is a field of an API answer: a List repeats over the whole answer of a query that answers a list')
  })

  it('refuses a List inserted over one record, and accepts one over a list answer', () => {
    const p = shop()
    const insert = (items: string) => ({ file: 'pg_index', type: 'List', props: { items: { $bind: items }, as: 'row' } })
    expect(p.refuse('node_insert', insert('first'), 'invalid').message).toMatch(/^"first" is one record, not a list/)
    p.edit('node_insert', insert('products'))
    bindQuotes(p)
  })

  it('api_query_set can\'t turn the list a List repeats over into one record', () => {
    const p = shop()
    bindQuotes(p)
    const refusal = p.refuse('api_query_set', { datasource: SHOP, query: { name: 'products', path: '/products', params: [], result: { model: 'Product', many: false } } }, 'invalid').message
    expect(refusal).toMatch(/^The query "products" of the API "shop" is used by .*its model and its one\/many can't change while they use it/)
    p.edit('api_query_set', { datasource: SHOP, query: { name: 'spare', path: '/spare', params: [], result: { model: 'Product', many: true } } })
    p.edit('api_query_set', { datasource: SHOP, query: { name: 'spare', path: '/spare', params: [], result: { model: 'Product', many: false } } })
  })
})

describe('S1: a route parameter fills an integer or number parameter', () => {
  it('accepts it for integer and number parameters on add and update, and still refuses it for a boolean', () => {
    const p = shop()
    const { pageId } = p.edit('page_create', { name: 'rate', path: '/rate/:id/:score' })
    p.edit('page_use_add', { page: pageId, as: 'rated', api: { datasource: SHOP, query: 'rate' }, args: { id: { $route: 'id' }, score: { $route: 'score' } } })
    p.edit('page_use_add', { page: pageId, as: 'again', api: { datasource: SHOP, query: 'product' }, args: { id: 1 } })
    p.edit('page_use_update', { page: pageId, as: 'again', args: { id: { $route: 'id' } } })
    expect(p.refuse('page_use_update', { page: pageId, as: 'rated', args: { flag: { $route: 'id' } } }, 'invalid').message)
      .toBe('The query "rate" of the API "shop" takes "flag" as boolean, but the page passes {"$route":"id"}')
    expect(p.refuse('page_use_add', { page: pageId, as: 'other', api: { datasource: SHOP, query: 'rate' }, args: { id: { $route: 'id' }, flag: { $route: 'id' } } }, 'invalid').message).toMatch(/takes "flag" as boolean/)
  })

  it('loads a page whose integer parameter reads the route', () => {
    const p = shop()
    const { pageId } = p.edit('page_create', { name: 'item', path: '/item/:id' })
    p.edit('page_use_add', { page: pageId, as: 'found', api: { datasource: SHOP, query: 'product' }, args: { id: { $route: 'id' } } })
    expect(p.model().modules.blog!.pages.find(page => page.id === pageId)!.uses!.apis![0]!.args).toEqual({ id: { $route: 'id' } })
  })
})

describe('apiParamAcceptsStateField (what the editor offers a parameter)', () => {
  const param = (type: 'text' | 'integer' | 'number' | 'boolean', required = false) => ({ name: 'p', in: 'query' as const, type, required })
  const field = (type: string, extra: Record<string, unknown> = {}) => ({ id: 'f', name: 'f', type, ...extra }) as never

  it('offers a field only of a type the parameter takes', () => {
    expect(apiParamAcceptsStateField(param('text'), field('text'))).toBe(true)
    expect(apiParamAcceptsStateField(param('text'), field('date'))).toBe(true)
    expect(apiParamAcceptsStateField(param('text'), field('boolean'))).toBe(false)
    expect(apiParamAcceptsStateField(param('integer'), field('integer'))).toBe(true)
    expect(apiParamAcceptsStateField(param('integer'), field('number'))).toBe(false)
    expect(apiParamAcceptsStateField(param('number'), field('integer'))).toBe(true)
    expect(apiParamAcceptsStateField(param('boolean'), field('text'))).toBe(false)
  })

  it('offers a field that can be null never (it needs a fallback), one that can be empty only to a parameter that can be left out', () => {
    expect(apiParamAcceptsStateField(param('text'), field('text', { nullable: true }))).toBe(false)
    expect(apiParamAcceptsStateField(param('text', true), field('text', { nullable: true, default: 'a' }))).toBe(false)
    expect(apiParamAcceptsStateField(param('text'), field('text'))).toBe(true)
    expect(apiParamAcceptsStateField(param('text', true), field('text'))).toBe(false)
    expect(apiParamAcceptsStateField(param('text', true), field('text', { required: true }))).toBe(true)
    expect(apiParamAcceptsStateField(param('text', true), field('text', { default: 'a' }))).toBe(true)
    expect(apiParamAcceptsStateField({ name: 'p', in: 'path', type: 'text' }, field('text'))).toBe(false)
  })
})
