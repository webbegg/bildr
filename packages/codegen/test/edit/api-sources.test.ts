// Simple data P1: API data sources own their base URL, models, queries and actions (SD-2).
import { describe, expect, it } from 'vitest'
import { loadModel } from '../../src/model/load'
import { project } from './helpers'

const FILE = '.bildr/datasources/shop-api.json'

const withApi = (input: Record<string, unknown> = {}) => {
  const p = project()
  const made = p.edit('api_create', { name: 'Shop API', baseUrl: 'https://shop.example.com/v1', ...input })
  return { p, made }
}

const PRODUCT = { name: 'Product', fields: [{ name: 'id', type: 'integer' }, { name: 'title', type: 'text' }, { name: 'price', type: 'number', optional: true }] }

describe('api_create and api_update', () => {
  it('writes an api source with a first-class baseUrl, server runtime by default and empty operations', () => {
    const { p, made } = withApi()
    expect(made).toMatchObject({ datasourceId: 'ds_shop_api', filePath: FILE })
    expect(p.json(FILE)).toEqual({
      id: 'ds_shop_api',
      name: 'shop-api',
      kind: 'api',
      env: { baseUrl: 'NUXT_APIS_SHOP_API_BASE_URL' },
      baseUrl: 'https://shop.example.com/v1',
      runtime: 'server',
      models: [],
      queries: [],
      actions: []
    })
  })

  it('the secret is an env var only; browser runtime takes public env names and no secret auth', () => {
    const { p } = withApi({ auth: { type: 'bearer' } })
    expect(p.json(FILE)).toMatchObject({
      env: { baseUrl: 'NUXT_APIS_SHOP_API_BASE_URL', apiKey: 'NUXT_APIS_SHOP_API_API_KEY' },
      auth: { type: 'bearer', secret: 'apiKey' }
    })
    expect(p.refuse('api_update', { datasource: 'ds_shop_api', runtime: 'browser' }, 'invalid').message)
      .toBe('An API that runs in the browser can\'t use a secret: the browser would see it. Run it on the server, or remove the auth')
    p.edit('api_update', { datasource: 'ds_shop_api', runtime: 'browser', auth: null })
    expect(p.json(FILE)).toMatchObject({ runtime: 'browser', env: { baseUrl: 'NUXT_PUBLIC_APIS_SHOP_API_BASE_URL' } })
    expect(p.json(FILE).auth).toBeUndefined()
  })

  it('checks the base URL like a REST source', () => {
    const p = project()
    expect(p.refuse('api_create', { name: 'x', baseUrl: 'api.example.com' }, 'invalid').message)
      .toBe('"api.example.com" is not an absolute URL, like "https://api.example.com/v1"')
    expect(p.refuse('api_create', { name: 'x', baseUrl: 'https://u:p@api.example.com' }, 'invalid').message)
      .toBe('A base URL can\'t hold a user name or password: put the secret in an env var (auth)')
    expect(p.refuse('api_create', { name: 'x', baseUrl: 'https://api.example.com/?k=1' }, 'invalid').message)
      .toBe('A base URL has no query or fragment')
  })

  it('renames and changes the base URL', () => {
    const { p } = withApi()
    p.edit('api_update', { datasource: 'ds_shop_api', name: 'Store', baseUrl: 'https://store.example.com' })
    expect(p.json(FILE)).toMatchObject({ name: 'store', baseUrl: 'https://store.example.com' })
  })

  it('datasource_create does not make api sources, and an entity can\'t live on one', () => {
    const { p } = withApi()
    expect(p.refuse('datasource_create', { name: 'y', kind: 'api' }, 'invalid_input').code).toBe('invalid_input')
    expect(p.refuse('entity_create', { name: 'Thing', source: 'ds_shop_api', fields: [{ name: 'title', type: 'text' }] }, 'invalid').message)
      .toBe('"shop-api" is an API data source: it has queries and actions, not collections')
    expect(p.edit('datasource_delete', { datasource: 'ds_shop_api' }).changes).toEqual([{ path: FILE, content: null }])
  })
})

describe('models', () => {
  it('api_model_set adds and replaces a model; nested models and lists', () => {
    const { p } = withApi()
    p.edit('api_model_set', { datasource: 'ds_shop_api', model: PRODUCT })
    p.edit('api_model_set', { datasource: 'ds_shop_api', model: { name: 'Tag', fields: [{ name: 'label', type: 'text' }] } })
    p.edit('api_model_set', { datasource: 'ds_shop_api', model: { ...PRODUCT, fields: [...PRODUCT.fields, { name: 'tags', type: 'model', model: 'Tag', list: true }, { name: 'createdAt', type: 'datetime', key: 'created_at' }] } })
    const models = p.json(FILE).models
    expect(models.map((model: { name: string }) => model.name)).toEqual(['Product', 'Tag'])
    expect(models[0].fields.at(-2)).toEqual({ name: 'tags', type: 'model', model: 'Tag', list: true })
    expect(models[0].fields.at(-1)).toEqual({ name: 'createdAt', type: 'datetime', key: 'created_at' })
  })

  it('refuses unknown nested models, cycles, and duplicate fields', () => {
    const { p } = withApi()
    expect(p.refuse('api_model_set', { datasource: 'ds_shop_api', model: { name: 'A', fields: [{ name: 'b', type: 'model', model: 'B' }] } }, 'invalid').message)
      .toMatch(/Unknown model "B"/)
    p.edit('api_model_set', { datasource: 'ds_shop_api', model: { name: 'B', fields: [{ name: 'x', type: 'text' }] } })
    p.edit('api_model_set', { datasource: 'ds_shop_api', model: { name: 'A', fields: [{ name: 'b', type: 'model', model: 'B' }] } })
    expect(p.refuse('api_model_set', { datasource: 'ds_shop_api', model: { name: 'B', fields: [{ name: 'a', type: 'model', model: 'A' }] } }, 'invalid').message)
      .toMatch(/Model cycle: B → A → B/)
    expect(p.refuse('api_model_set', { datasource: 'ds_shop_api', model: { name: 'C', fields: [{ name: 'x', type: 'text' }, { name: 'x', type: 'number' }] } }, 'invalid').message)
      .toMatch(/Two fields of C are named "x"/)
    expect(p.refuse('api_model_set', { datasource: 'ds_shop_api', model: { name: 'D', fields: [{ name: 'x', type: 'text', model: 'B' }] } }, 'invalid').message)
      .toMatch(/Only a "model" field names a model/)
  })

  it('api_model_rename updates every reference; api_model_delete is refused while used', () => {
    const { p } = withApi()
    p.edit('api_model_set', { datasource: 'ds_shop_api', model: { name: 'Tag', fields: [{ name: 'label', type: 'text' }] } })
    p.edit('api_model_set', { datasource: 'ds_shop_api', model: { ...PRODUCT, fields: [...PRODUCT.fields, { name: 'tags', type: 'model', model: 'Tag', list: true }] } })
    p.edit('api_query_set', { datasource: 'ds_shop_api', query: { name: 'products', path: '/products', result: { model: 'Product', many: true } } })
    p.edit('api_action_set', { datasource: 'ds_shop_api', action: { name: 'createProduct', method: 'POST', path: '/products', body: { model: 'Product' }, result: { model: 'Product', many: false } } })
    p.edit('api_model_rename', { datasource: 'ds_shop_api', model: 'Product', name: 'Item' })
    p.edit('api_model_rename', { datasource: 'ds_shop_api', model: 'Tag', name: 'Label' })
    const file = p.json(FILE)
    expect(file.models.map((model: { name: string }) => model.name)).toEqual(['Label', 'Item'])
    expect(file.models[1].fields.at(-1).model).toBe('Label')
    expect(file.queries[0].result.model).toBe('Item')
    expect(file.actions[0]).toMatchObject({ body: { model: 'Item' }, result: { model: 'Item' } })
    expect(p.refuse('api_model_delete', { datasource: 'ds_shop_api', model: 'Item' }, 'invalid').message)
      .toBe('Item is used by the query products and the action createProduct')
    expect(p.refuse('api_model_delete', { datasource: 'ds_shop_api', model: 'Label' }, 'invalid').message)
      .toBe('Label is used by the model Item')
    expect(p.refuse('api_model_rename', { datasource: 'ds_shop_api', model: 'Item', name: 'Label' }, 'invalid').message)
      .toBe('A model is already named "Label"')
  })
})

describe('queries and actions', () => {
  const ready = () => {
    const { p } = withApi()
    p.edit('api_model_set', { datasource: 'ds_shop_api', model: PRODUCT })
    return p
  }

  it('api_query_set adds and replaces a query with path and query params', () => {
    const p = ready()
    p.edit('api_query_set', { datasource: 'ds_shop_api', query: { name: 'products', path: '/products', params: [{ name: 'search', in: 'query', type: 'text', key: 'q' }], result: { model: 'Product', many: true, itemsPath: 'data.items' } } })
    p.edit('api_query_set', { datasource: 'ds_shop_api', query: { name: 'product', path: '/products/:id', params: [{ name: 'id', in: 'path', type: 'integer' }], result: { model: 'Product', many: false } } })
    p.edit('api_query_set', { datasource: 'ds_shop_api', query: { name: 'products', description: 'All products', path: '/products', result: { model: 'Product', many: true } } })
    const { queries } = p.json(FILE)
    expect(queries).toEqual([
      { name: 'products', description: 'All products', path: '/products', params: [], result: { model: 'Product', many: true } },
      { name: 'product', path: '/products/:id', params: [{ name: 'id', in: 'path', type: 'integer' }], result: { model: 'Product', many: false } }
    ])
  })

  it('path parameters and params agree; paths stay under the base', () => {
    const p = ready()
    const query = (path: string, params: unknown[] = []) => ({ datasource: 'ds_shop_api', query: { name: 'q', path, params, result: { model: 'Product', many: false } } })
    expect(p.refuse('api_query_set', query('/products/:id'), 'invalid').message).toMatch(/":id" in the path needs a path parameter "id"/)
    expect(p.refuse('api_query_set', query('/products', [{ name: 'id', in: 'path', type: 'text' }]), 'invalid').message).toMatch(/Path parameter "id" is not in the path/)
    expect(p.refuse('api_query_set', query('/products/../admin'), 'invalid').message).toMatch(/A path is "\/" followed by segments/)
    expect(p.refuse('api_query_set', query('https://evil.example.com/x'), 'invalid').message).toMatch(/A path is "\/" followed by segments/)
    expect(p.refuse('api_query_set', query('/p?x=1'), 'invalid').message).toMatch(/A path is "\/" followed by segments/)
    expect(p.refuse('api_query_set', query('/p', [{ name: 'a', in: 'query', type: 'text' }, { name: 'a', in: 'query', type: 'text' }]), 'invalid').message).toMatch(/Two parameters are named "a"/)
    expect(p.refuse('api_query_set', { datasource: 'ds_shop_api', query: { name: 'q', path: '/p', result: { model: 'Nope', many: true } } }, 'invalid').message).toMatch(/Unknown model "Nope"/)
  })

  it('itemsPath takes the JSON keys lists sit under: dots between keys like "item-list" or "hydra:member" (verify P4)', () => {
    const p = ready()
    for (const itemsPath of ['item-list', 'hydra:member', '@graph', 'data.item-list', '$items']) {
      p.edit('api_query_set', { datasource: 'ds_shop_api', query: { name: 'products', path: '/products', result: { model: 'Product', many: true, itemsPath } } })
    }
    for (const itemsPath of ['', 'a..b', '.a', 'a.', 'a b', 'a/b', 'a[0]']) {
      expect(p.refuse('api_query_set', { datasource: 'ds_shop_api', query: { name: 'products', path: '/products', result: { model: 'Product', many: true, itemsPath } } }, 'invalid_input').code, itemsPath).toBe('invalid_input')
    }
  })

  it('api_action_set: methods other than GET, optional body and result', () => {
    const p = ready()
    p.edit('api_action_set', { datasource: 'ds_shop_api', action: { name: 'deleteProduct', method: 'DELETE', path: '/products/:id', params: [{ name: 'id', in: 'path', type: 'integer' }] } })
    expect(p.json(FILE).actions).toEqual([{ name: 'deleteProduct', method: 'DELETE', path: '/products/:id', params: [{ name: 'id', in: 'path', type: 'integer' }] }])
    expect(p.refuse('api_action_set', { datasource: 'ds_shop_api', action: { name: 'x', method: 'GET', path: '/x' } }, 'invalid_input').code).toBe('invalid_input')
  })

  it('a query and an action can\'t share a name; rename and delete', () => {
    const p = ready()
    p.edit('api_query_set', { datasource: 'ds_shop_api', query: { name: 'products', path: '/products', result: { model: 'Product', many: true } } })
    expect(p.refuse('api_action_set', { datasource: 'ds_shop_api', action: { name: 'products', method: 'POST', path: '/products' } }, 'invalid').message)
      .toBe('The query "products" already has this name')
    p.edit('api_action_set', { datasource: 'ds_shop_api', action: { name: 'addProduct', method: 'POST', path: '/products' } })
    p.edit('api_query_rename', { datasource: 'ds_shop_api', query: 'products', name: 'allProducts' })
    p.edit('api_action_rename', { datasource: 'ds_shop_api', action: 'addProduct', name: 'createProduct' })
    expect(p.refuse('api_query_rename', { datasource: 'ds_shop_api', query: 'allProducts', name: 'createProduct' }, 'invalid').message)
      .toBe('The action "createProduct" already has this name')
    expect(p.json(FILE)).toMatchObject({ queries: [{ name: 'allProducts' }], actions: [{ name: 'createProduct' }] })
    p.edit('api_query_delete', { datasource: 'ds_shop_api', query: 'allProducts' })
    p.edit('api_action_delete', { datasource: 'ds_shop_api', action: 'createProduct' })
    expect(p.json(FILE)).toMatchObject({ queries: [], actions: [] })
    expect(p.refuse('api_query_delete', { datasource: 'ds_shop_api', query: 'gone' }, 'not_found').message).toBe('No query "gone" in shop-api')
  })

  it('api edits refuse a non-api source', () => {
    expect(project().refuse('api_query_set', { datasource: 'ds_main', query: { name: 'q', path: '/q', result: { model: 'X', many: true } } }, 'invalid').message)
      .toBe('"main" is not an API data source')
  })
})

describe('loading', () => {
  it('a hand-written api file is checked like the edits check it', () => {
    const files = project().files
    const bad = { ...files, [FILE]: JSON.stringify({ id: 'ds_shop_api', name: 'shop-api', kind: 'api', env: {}, baseUrl: 'https://x.example.com', runtime: 'browser', auth: { type: 'bearer', secret: 'apiKey' }, models: [], queries: [{ name: 'q', path: '/q/:id', params: [], result: { model: 'Missing', many: true } }], actions: [] }) }
    const loaded = loadModel(bad)
    expect(loaded.ok).toBe(false)
    const messages = loaded.ok ? [] : loaded.problems.map(problem => problem.message)
    expect(messages).toEqual(expect.arrayContaining([
      expect.stringMatching(/can't use a secret/),
      expect.stringMatching(/":id" in the path needs a path parameter "id"/),
      expect.stringMatching(/Unknown model "Missing"/)
    ]))
    const rest = { ...files, [FILE]: JSON.stringify({ id: 'ds_shop_api', name: 'shop-api', kind: 'rest', env: {}, queries: [] }) }
    const restLoaded = loadModel(rest)
    expect(restLoaded.ok).toBe(false)
  })
})
