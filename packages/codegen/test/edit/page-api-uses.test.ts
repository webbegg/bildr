import { describe, expect, it } from 'vitest'
import { apiQueryUsesOf, bindingPaths, bindingScope, usesOf } from '../../src/edit/index'
import { IDX, project } from './helpers'

/** Simple data P7a (SD-6): a page uses an API query (`uses.apis`), and every edit that touches the source keeps the page consistent. */

const SHOP = 'ds_shop'

/** The golden blog with a "shop" API: a nested model, a list field, a model without an id, and three queries. */
const shop = () => {
  const p = project()
  p.edit('api_create', { name: 'shop', baseUrl: 'https://shop.example.com/v1' })
  p.edit('api_model_set', { datasource: SHOP, model: { name: 'Address', fields: [{ name: 'city', type: 'text' }, { name: 'zip', type: 'text', optional: true }] } })
  p.edit('api_model_set', {
    datasource: SHOP,
    model: {
      name: 'Product',
      fields: [
        { name: 'id', type: 'integer' }, { name: 'title', type: 'text' }, { name: 'subtitle', type: 'text', optional: true }, { name: 'price', type: 'number' },
        { name: 'address', type: 'model', model: 'Address', optional: true }, { name: 'tags', type: 'text', list: true }
      ]
    }
  })
  p.edit('api_model_set', { datasource: SHOP, model: { name: 'Note', fields: [{ name: 'text', type: 'text' }] } })
  p.edit('api_query_set', { datasource: SHOP, query: { name: 'products', path: '/products', params: [{ name: 'category', in: 'query', type: 'text' }, { name: 'page', in: 'query', type: 'integer', required: true }], result: { model: 'Product', many: true } } })
  p.edit('api_query_set', { datasource: SHOP, query: { name: 'product', path: '/products/:id', params: [{ name: 'id', in: 'path', type: 'integer' }], result: { model: 'Product', many: false } } })
  p.edit('api_query_set', { datasource: SHOP, query: { name: 'notes', path: '/notes', params: [], result: { model: 'Note', many: true } } })
  return p
}

/** The index page's quotes List repeats `items` as `as`, its text reading `text` (`{as.title}`): plain edits, the generator checks each. */
const listOver = (p: ReturnType<typeof shop>, items: string, as: string, text = `{${as}.title}`) => {
  p.edit('node_update_props', { file: 'pg_index', nodeId: 'n_quote', props: { text: 'Quote' } })
  p.edit('node_update_props', { file: 'pg_index', nodeId: 'n_quotes', props: { items: { $bind: items }, as } })
  p.edit('node_update_props', { file: 'pg_index', nodeId: 'n_quote', props: { text: { $template: text } } })
}

const useProducts = (p: ReturnType<typeof shop>, as = 'products') =>
  p.edit('page_use_add', { page: 'pg_index', as, api: { datasource: SHOP, query: 'products' }, args: { page: 1 } })

describe('page_use_add with an API query', () => {
  it('writes uses.apis, with the args, and leaves uses.queries alone', () => {
    const p = shop()
    expect(useProducts(p)).toMatchObject({ as: 'products' })
    const uses = p.json(IDX).uses
    expect(uses.apis).toEqual([{ as: 'products', datasource: SHOP, query: 'products', args: { page: 1 } }])
    expect(uses.queries).toHaveLength(3)
  })

  it('takes no args when the query has no parameters', () => {
    const p = shop()
    p.edit('page_use_add', { page: 'pg_index', as: 'notes', api: { datasource: SHOP, query: 'notes' } })
    expect(p.json(IDX).uses.apis).toEqual([{ as: 'notes', datasource: SHOP, query: 'notes' }])
  })

  it('refuses what the source can\'t serve, with clear messages', () => {
    const p = shop()
    const refuse = (input: Record<string, unknown>, code = 'invalid') => p.refuse('page_use_add', { page: 'pg_index', as: 'x', ...input }, code).message
    expect(refuse({ api: { datasource: 'ds_main', query: 'products' } })).toBe('"main" is not an API data source')
    expect(refuse({ api: { datasource: 'ds_nope', query: 'products' } }, 'not_found')).toMatch(/ds_nope/)
    expect(refuse({ api: { datasource: SHOP, query: 'nope' } }, 'not_found')).toBe('No query "nope" in shop')
    expect(refuse({ api: { datasource: SHOP, query: 'products' } })).toBe('The query "products" of the API "shop" needs "page"')
    expect(refuse({ api: { datasource: SHOP, query: 'products' }, args: { page: 1, nope: 2 } })).toBe('The query "products" of the API "shop" has no parameter "nope" (category, page)')
    expect(refuse({ api: { datasource: SHOP, query: 'products' }, args: { page: 'one' } })).toBe('The query "products" of the API "shop" takes "page" as integer, but the page passes "one"')
    expect(refuse({ api: { datasource: SHOP, query: 'product' }, args: { id: { not: true } } })).toMatch(/takes "id" as integer, but the page passes/)
    expect(refuse({ api: { datasource: SHOP, query: 'notes' }, query: 'q_all_posts' })).toBe('Give one query, action, state or API query to use')
    expect(refuse({ api: { datasource: SHOP, query: 'notes' }, state: 'st_preferences' })).toBe('Give one query, action, state or API query to use')
    expect(refuse({ api: { datasource: SHOP, query: 'notes' }, as: 'site' })).toMatch(/"site" is a name the page's script uses itself/)
  })

  it('refuses a name the page already uses or derives', () => {
    const p = shop()
    useProducts(p)
    expect(p.refuse('page_use_add', { page: 'pg_index', as: 'products', api: { datasource: SHOP, query: 'notes' } }, 'invalid').message).toBe('The page already uses the name "products"')
    expect(p.refuse('page_use_add', { page: 'pg_index', as: 'productsStatus', api: { datasource: SHOP, query: 'notes' } }, 'invalid').message)
      .toBe('The page\'s script would declare "productsStatus" twice: as the status of "products" and as "productsStatus"')
    // An API query's loading and error are its status now (T3c): the names are free.
    p.edit('page_use_add', { page: 'pg_index', as: 'productsLoading', api: { datasource: SHOP, query: 'notes' } })
    p.edit('page_use_add', { page: 'pg_index', as: 'productsError', api: { datasource: SHOP, query: 'notes' } })
    // A name another use of the page has can't be taken by an API use either.
    expect(p.refuse('page_use_add', { page: 'pg_index', as: 'featured', api: { datasource: SHOP, query: 'notes' } }, 'invalid').message).toBe('The page already uses the name "featured"')
  })

  it('accepts a route parameter for a text parameter (a number one is converted: see page-api-uses-review)', () => {
    const p = shop()
    p.edit('page_use_add', { page: 'pg_post_detail', as: 'cat', api: { datasource: SHOP, query: 'products' }, args: { page: 1, category: { $route: 'slug' } } })
    expect(p.json('.bildr/modules/blog/pages/post-detail.json').uses.apis[0].args).toEqual({ page: 1, category: { $route: 'slug' } })
  })
})

describe('page_use_update and page_use_remove on an API use', () => {
  it('sets and removes args, keeping the required ones', () => {
    const p = shop()
    useProducts(p)
    p.edit('page_use_update', { page: 'pg_index', as: 'products', args: { category: 'books', page: 2 } })
    expect(p.json(IDX).uses.apis[0].args).toEqual({ page: 2, category: 'books' })
    p.edit('page_use_update', { page: 'pg_index', as: 'products', args: { category: null } })
    expect(p.json(IDX).uses.apis[0].args).toEqual({ page: 2 })
    expect(p.refuse('page_use_update', { page: 'pg_index', as: 'products', args: { page: null } }, 'invalid').message).toBe('The query "products" of the API "shop" needs "page"')
    expect(p.refuse('page_use_update', { page: 'pg_index', as: 'products', args: { nope: 1 } }, 'invalid').message).toMatch(/has no parameter "nope"/)
  })

  it('removes the use and its empty list, refused while the page binds the name', () => {
    const p = shop()
    useProducts(p)
    p.edit('node_update_props', { file: 'pg_index', nodeId: 'n_h1', props: { text: { $template: '{products.length} products' } } })
    expect(p.refuse('page_use_remove', { page: 'pg_index', as: 'products' }, 'invalid').message).toBe('The page still binds "products": change what reads it first')
    p.edit('node_update_props', { file: 'pg_index', nodeId: 'n_h1', props: { text: 'Posts' } })
    p.edit('page_use_remove', { page: 'pg_index', as: 'products' })
    expect(p.json(IDX).uses.apis).toBeUndefined()
  })
})

describe('bindingScope over API uses', () => {
  const listed = () => {
    const p = shop()
    useProducts(p)
    listOver(p, 'products', 'product')
    return p
  }

  it('exposes a list as a list, with the fields of its model (nested ones, a list field\'s length) on its item', () => {
    const scope = bindingScope(listed().model(), 'pg_index', 'n_quote')
    expect(scope.find(entry => entry.name === 'products')).toMatchObject({ source: 'query', many: true })
    expect(scope.find(entry => entry.name === 'product')).toMatchObject({ source: 'item', many: false })
    expect(scope.find(entry => entry.name === 'product')!.fields).toEqual(['id', 'title', 'subtitle', 'price', 'address', 'address.city', 'address.zip', 'tags', 'tags.length'])
    expect(bindingPaths(scope).filter(path => path.startsWith('products'))).toEqual(['products', 'products.length'])
  })

  it('exposes a one result as one record with the same fields', () => {
    const p = shop()
    p.edit('page_use_add', { page: 'pg_index', as: 'first', api: { datasource: SHOP, query: 'product' }, args: { id: 1 } })
    const scope = bindingScope(p.model(), 'pg_index', 'n_h1')
    expect(scope.find(entry => entry.name === 'first')).toMatchObject({ source: 'query', many: false })
    expect(bindingPaths(scope)).toContain('first.address.city')
  })

  it('has the item only inside its List', () => {
    const p = listed()
    expect(bindingScope(p.model(), 'pg_index', 'n_h1').some(entry => entry.name === 'product')).toBe(false)
    const one = shop()
    one.edit('page_use_add', { page: 'pg_index', as: 'first', api: { datasource: SHOP, query: 'product' }, args: { id: 1 } })
    // A List can't repeat over one record (the module refuses it, see page-api-uses-review): it has no item named after it.
    expect(bindingScope(one.model(), 'pg_index', 'n_quote').some(entry => entry.name === 'row')).toBe(false)
  })
})

describe('usage of API queries', () => {
  it('reports the uses and the bindings of a query, by source and by query', () => {
    const p = shop()
    useProducts(p)
    p.edit('page_use_add', { page: 'pg_index', as: 'notes', api: { datasource: SHOP, query: 'notes' } })
    p.edit('node_update_props', { file: 'pg_index', nodeId: 'n_h1', props: { text: { $template: '{products.length} products' } } })
    const model = p.model()
    expect(apiQueryUsesOf(model, SHOP, 'products')).toEqual([
      { kind: 'page', id: 'pg_index', name: 'index', via: 'uses', where: 'uses', as: 'products', operation: 'products' },
      { kind: 'page', id: 'pg_index', name: 'index', via: 'bind', where: 'n_h1', node: 'n_h1', as: 'products', operation: 'products' }
    ])
    expect(apiQueryUsesOf(model, SHOP, 'notes')).toEqual([{ kind: 'page', id: 'pg_index', name: 'index', via: 'uses', where: 'uses', as: 'notes', operation: 'notes' }])
    expect(apiQueryUsesOf(model, SHOP, 'product')).toEqual([])
    // The source as a whole: every query a page uses.
    expect(usesOf(model, SHOP).filter(use => use.via === 'uses').map(use => use.as)).toEqual(['products', 'notes'])
  })
})

describe('what the source\'s edits do to pages that use it', () => {
  it('api_query_rename follows into the page uses', () => {
    const p = shop()
    useProducts(p)
    p.edit('api_query_rename', { datasource: SHOP, query: 'products', name: 'catalog' })
    expect(p.json(IDX).uses.apis).toEqual([{ as: 'products', datasource: SHOP, query: 'catalog', args: { page: 1 } }])
    expect(p.model().datasources.find(source => source.id === SHOP)!.queries!.map(query => query.name)).toContain('catalog')
  })

  it('api_query_rename refuses a name whose composable the page already declares', () => {
    const p = shop()
    useProducts(p)
    p.edit('page_use_add', { page: 'pg_index', as: 'useShopCatalog', api: { datasource: SHOP, query: 'notes' } })
    expect(p.refuse('api_query_rename', { datasource: SHOP, query: 'products', name: 'catalog' }, 'invalid').message).toMatch(/would declare "useShopCatalog" twice/)
  })

  it('api_query_delete and datasource_delete are refused while a page uses the query', () => {
    const p = shop()
    useProducts(p)
    expect(p.refuse('api_query_delete', { datasource: SHOP, query: 'products' }, 'invalid').message)
      .toBe('The query "products" of the API "shop" is still used: page "index" (pg_index) uses its query "products" as "products". Change them first')
    p.edit('api_query_delete', { datasource: SHOP, query: 'notes' })
    expect(p.refuse('datasource_delete', { datasource: SHOP }, 'invalid').message)
      .toBe('Data source "shop" is still used: page "index" (pg_index) uses its query "products" as "products". Change them first')
    p.edit('page_use_remove', { page: 'pg_index', as: 'products' })
    p.edit('datasource_delete', { datasource: SHOP })
  })

  it('api_update renaming the source is refused when a composable would meet a name the page declares, and follows otherwise', () => {
    const p = shop()
    useProducts(p)
    p.edit('page_use_add', { page: 'pg_index', as: 'useStoreProducts', api: { datasource: SHOP, query: 'notes' } })
    expect(p.refuse('api_update', { datasource: SHOP, name: 'store' }, 'invalid').message).toMatch(/would declare "useStoreProducts" twice/)
    const q = shop()
    useProducts(q)
    q.edit('api_update', { datasource: SHOP, name: 'store' })
    expect(q.json(IDX).uses.apis[0]).toMatchObject({ datasource: SHOP, query: 'products' })
  })

  it('api_model_set keeps the bound fields: it refuses to drop one a node reads, and lets others go', () => {
    const p = shop()
    useProducts(p)
    listOver(p, 'products', 'product', '{product.title} in {product.address.city}')
    const product = (fields: Array<Record<string, unknown>>) => ({ datasource: SHOP, model: { name: 'Product', fields } })
    const keep = [{ name: 'id', type: 'integer' }, { name: 'title', type: 'text' }, { name: 'price', type: 'number' }, { name: 'address', type: 'model', model: 'Address' }]
    expect(p.refuse('api_model_set', product(keep.filter(field => field.name !== 'title')), 'invalid').message)
      .toBe('The query "products" of the API "shop" is read by page "index" (pg_index): n_quote binds "product.title", which the model no longer has. Change them first')
    expect(p.refuse('api_model_set', { datasource: SHOP, model: { name: 'Address', fields: [{ name: 'town', type: 'text' }] } }, 'invalid').message).toMatch(/binds "product.address.city"/)
    p.edit('api_model_set', product(keep))
  })

  it('api_query_set refuses to change what a page binds (one or many, the model) or the params it passes', () => {
    const p = shop()
    useProducts(p)
    const products = { name: 'products', path: '/products', params: [{ name: 'category', in: 'query', type: 'text' }, { name: 'page', in: 'query', type: 'integer', required: true }], result: { model: 'Product', many: true } }
    expect(p.refuse('api_query_set', { datasource: SHOP, query: { ...products, result: { model: 'Product', many: false } } }, 'invalid').message)
      .toBe('The query "products" of the API "shop" is used by page "index" (pg_index) uses its query "products" as "products": its model and its one/many can\'t change while they use it. Change them first')
    expect(p.refuse('api_query_set', { datasource: SHOP, query: { ...products, result: { model: 'Note', many: true } } }, 'invalid').message).toMatch(/its model and its one\/many can't change/)
    expect(p.refuse('api_query_set', { datasource: SHOP, query: { ...products, params: [{ name: 'category', in: 'query', type: 'text' }] } }, 'invalid').message)
      .toBe('The query "products" of the API "shop" has no parameter "page", but page "index" (pg_index) passes it as "products": change it first')
    expect(p.refuse('api_query_set', { datasource: SHOP, query: { ...products, params: [...products.params, { name: 'sort', in: 'query', type: 'text', required: true }] } }, 'invalid').message)
      .toBe('The query "products" of the API "shop" needs "sort", but page "index" (pg_index) doesn\'t pass it as "products": change it first')
    p.edit('api_query_set', { datasource: SHOP, query: { ...products, description: 'All of them' } })
  })
})
