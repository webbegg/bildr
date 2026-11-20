// Simple data P1 verify: a hand-written api file keeps the edit rules (blocker 1 and its warnings).
import { describe, expect, it } from 'vitest'
import { datasourceEnvVars } from '../../src/edit/index'
import { loadModel } from '../../src/model/load'
import { fixtureModelFiles } from '../model/fixture'
import { project } from './helpers'

const FILE = '.bildr/datasources/shop-api.json'
const file = (patch: Record<string, unknown>) => ({ id: 'ds_shop_api', name: 'shop-api', kind: 'api', env: { baseUrl: 'NUXT_DATASOURCES_SHOP_API_BASE_URL' }, baseUrl: 'https://x.example.com/v1', runtime: 'server', models: [], queries: [], actions: [], ...patch })
const load = (patch: Record<string, unknown>) => loadModel({ ...fixtureModelFiles(), [FILE]: JSON.stringify(file(patch)) })
const load_ = (baseUrl: string) => load({ baseUrl })

describe('a hand-written api file keeps the urlProblem rules', () => {
  it('loads a valid base URL', () => expect(load_('https://x.example.com/v1').ok).toBe(true))
  it('load refuses credentials in baseUrl', () => expect(load_('https://user:s3cret@x.example.com').ok).toBe(false))
  it('load refuses a query string in baseUrl', () => expect(load_('https://x.example.com/?token=abc').ok).toBe(false))
  it('load refuses a non-URL baseUrl', () => expect(load_('not a url').ok).toBe(false))
  it('load refuses a non-http baseUrl', () => expect(load_('javascript:alert(1)').ok).toBe(false))
})

describe('env names', () => {
  it('an api file needs the env var of its base URL', () => expect(load({ env: {} }).ok).toBe(false))

  it('the secret is not the base URL setting', () => {
    expect(project().refuse('api_create', { name: 'x', baseUrl: 'https://x.example.com', auth: { type: 'bearer', secret: 'baseUrl' } }, 'invalid').message)
      .toBe('"baseUrl" is the base URL setting: name the secret another way, like "apiKey"')
  })

  it('a rename re-derives the env names bildr gave; a user-named one stays', () => {
    const p = project()
    p.edit('api_create', { name: 'Shop API', baseUrl: 'https://shop.example.com/v1', auth: { type: 'bearer' } })
    p.edit('api_update', { datasource: 'ds_shop_api', name: 'Store' })
    expect(p.json('.bildr/datasources/shop-api.json').env).toEqual({ baseUrl: 'NUXT_DATASOURCES_STORE_BASE_URL', apiKey: 'NUXT_DATASOURCES_STORE_API_KEY' })
    const own = project({ ...p.files, [FILE]: JSON.stringify({ ...p.json(FILE), env: { baseUrl: 'NUXT_MY_URL', apiKey: 'NUXT_DATASOURCES_STORE_API_KEY' } }) })
    own.edit('api_update', { datasource: 'ds_shop_api', name: 'Shop' })
    expect(own.json(FILE).env).toEqual({ baseUrl: 'NUXT_MY_URL', apiKey: 'NUXT_DATASOURCES_SHOP_API_KEY' })
  })

  it('env_status knows the model holds the base URL default', () => {
    const p = project()
    p.edit('api_create', { name: 'Shop API', baseUrl: 'https://shop.example.com/v1' })
    expect(datasourceEnvVars(p.model()).find(entry => entry.datasource === 'ds_shop_api')).toMatchObject({ setting: 'baseUrl', hasDefault: true, secret: false })
  })
})

describe('review P1: the load check matches the edits', () => {
  const messages = (patch: Record<string, unknown>) => {
    const loaded = load(patch)
    // A load problem names its place first ("auth: …"): compare the rule's own words.
    return loaded.ok ? [] : loaded.problems.map(problem => problem.message.replace(/^[\w.]+: /, ''))
  }

  it('auth rules (R1-001)', () => {
    const env = { baseUrl: 'NUXT_DATASOURCES_SHOP_API_BASE_URL', apiKey: 'NUXT_DATASOURCES_SHOP_API_API_KEY' }
    expect(messages({ env, auth: { type: 'header', secret: 'apiKey' } })).toContain('A "header" auth needs the header name, like "X-Api-Key"')
    expect(messages({ env, auth: { type: 'bearer', secret: 'apiKey', header: 'X-Key' } })).toContain('A "bearer" auth sends "Authorization: Bearer …": it takes no header name')
    expect(messages({ env, auth: { type: 'header', secret: 'apiKey', header: 'X-Key\r\nHost: evil' } })).toContain('Use a header name like "X-Api-Key"')
    expect(messages({ env: { ...env, other: 'NUXT_OTHER' }, auth: { type: 'bearer', secret: 'apiKey' } })).toContain('An API data source reads only its base URL and its secret from env: remove "other"')
    const p = project()
    expect(p.refuse('api_create', { name: 'x', baseUrl: 'https://x.example.com', runtime: 'browser', auth: { type: 'bearer' } }, 'invalid').message).toMatch(/can't use a secret/)
    expect(p.refuse('api_create', { name: 'x', baseUrl: 'https://x.example.com', auth: { type: 'header' } }, 'invalid').message).toBe('A "header" auth needs the header name, like "X-Api-Key"')
  })

  it('the base URL env var matches the runtime (R1-002)', () => {
    expect(messages({ runtime: 'browser' })).toContain('An API that runs in the browser reads its base URL from a NUXT_PUBLIC_ env var')
    expect(messages({ env: { baseUrl: 'NUXT_PUBLIC_SHOP_URL' } })).toContain('An API that runs on the server reads its base URL from an env var that isn\'t NUXT_PUBLIC_: the page would see it')
    expect(load({ runtime: 'browser', env: { baseUrl: 'NUXT_PUBLIC_SHOP_URL' } }).ok).toBe(true)
  })

  it('kind keys, defaults, repositories and datasource_update (R3-001)', () => {
    expect(messages({ runtime: undefined })).toContain('An API data source needs "runtime"')
    expect(messages({ defaults: { x: 'y' } })).toContain('An API data source has its baseUrl, no other settings')
    const rest = loadModel({ ...fixtureModelFiles(), [FILE]: JSON.stringify({ id: 'ds_shop_api', name: 'shop-api', kind: 'rest', env: {}, queries: [] }) })
    expect(rest.ok ? [] : rest.problems.map(problem => problem.message.replace(/^[\w.]+: /, ''))).toContain('Only an API data source has "queries"')
    const p = project()
    p.edit('api_create', { name: 'Shop API', baseUrl: 'https://shop.example.com/v1' })
    expect(p.refuse('datasource_update', { datasource: 'ds_shop_api', name: 'x' }, 'invalid').message).toBe('"shop-api" is an API data source: change it with api_update')
    const repo = '.bildr/modules/blog/repositories/post.json'
    const onApi = loadModel({ ...p.files, [repo]: JSON.stringify({ ...JSON.parse(p.files[repo]!), datasource: 'ds_shop_api' }) })
    expect(onApi.ok ? [] : onApi.problems.map(problem => problem.message.replace(/^[\w.]+: /, ''))).toContain('"ds_shop_api" is an API data source: it has queries and actions, not collections')
  })

  it('operation rules (R3-001, R3-003)', () => {
    const models = [{ name: 'P', fields: [{ name: 'x', type: 'text' }] }]
    const action = { name: 'a', method: 'POST', path: '/a', params: [], body: { model: 'Nope' } }
    expect(messages({ models, actions: [action] })).toContain('a: Unknown model "Nope"')
    expect(messages({ models: [...models, ...models] })).toContain('A model is already named "P"')
    expect(messages({ models: [{ name: 'P', fields: [{ name: 'x', type: 'text' }, { name: 'y', type: 'text', key: 'x' }] }] })).toContain('Two fields of P read the key "x"')
    const query = { name: 'q', path: '/q', params: [], result: { model: 'P', many: true } }
    expect(messages({ models, queries: [query], actions: [{ ...action, name: 'q', body: undefined }] })).toContain('A query or action is already named "q"')
    expect(messages({ models, queries: [{ ...query, result: { model: 'P', many: false, itemsPath: 'data' } }] })).toContain('q: Only a list result reads its items at an itemsPath')
    expect(messages({ models, queries: [{ ...query, params: [{ name: 'a', in: 'query', type: 'text', key: 'k' }, { name: 'b', in: 'query', type: 'text', key: 'k' }] }] })).toContain('q: Two parameters send the key "k"')
    const p = project()
    p.edit('api_create', { name: 'Shop API', baseUrl: 'https://shop.example.com/v1' })
    p.edit('api_model_set', { datasource: 'ds_shop_api', model: models[0] })
    p.edit('api_query_set', { datasource: 'ds_shop_api', query: { name: 'one', path: '/one', result: { model: 'P', many: true } } })
    p.edit('api_query_set', { datasource: 'ds_shop_api', query: { name: 'two', path: '/two', result: { model: 'P', many: true } } })
    expect(p.refuse('api_query_rename', { datasource: 'ds_shop_api', query: 'one', name: 'two' }, 'invalid').message).toBe('The query "two" already has this name')
  })
})

describe('the cycle check', () => {
  it('stays linear on a deep chain of shared models (2^40 walks before the fix)', { timeout: 5000 }, () => {
    const models = Array.from({ length: 40 }, (_, index) => ({
      name: `M${index}`,
      fields: index === 39 ? [{ name: 'x', type: 'text' }] : [{ name: 'a', type: 'model', model: `M${index + 1}` }, { name: 'b', type: 'model', model: `M${index + 1}` }]
    }))
    expect(load({ models }).ok).toBe(true)
  })
})
