// api-calls R2 (S4): an API call can send fixed headers, and headers filled from a parameter (`in: "header"`). The source's sign-in stays
// the only place a secret lives: a header named like it, or a fixed value that looks like a secret, is refused, by the edits and the load.
import { describe, expect, it } from 'vitest'
import { apiHeaderProblem } from '../../src/model/schemas'
import { loadModel } from '../../src/model/load'
import { fixtureModelFiles } from '../model/fixture'
import { project } from './helpers'

const FILE = '.bildr/datasources/shop-api.json'
const MODELS = [{ name: 'P', fields: [{ name: 'x', type: 'text' }] }]
const file = (patch: Record<string, unknown>) => ({ id: 'ds_shop_api', name: 'shop-api', kind: 'api', env: { baseUrl: 'NUXT_APIS_SHOP_API_BASE_URL', apiKey: 'NUXT_APIS_SHOP_API_API_KEY' }, auth: { type: 'header', secret: 'apiKey', header: 'X-Shop-Key' }, baseUrl: 'https://x.example.com/v1', runtime: 'server', models: MODELS, queries: [], actions: [], ...patch })
const messages = (patch: Record<string, unknown>) => {
  const loaded = loadModel({ ...fixtureModelFiles(), [FILE]: JSON.stringify(file(patch)) })
  return loaded.ok ? [] : loaded.problems.map(problem => problem.message.replace(/^[\w.[\]]+: /, ''))
}
const query = (patch: Record<string, unknown>) => ({ name: 'q', path: '/q', params: [], result: { model: 'P', many: true }, ...patch })

describe('a header of a call', () => {
  const auth = { type: 'header' as const, secret: 'apiKey', header: 'X-Shop-Key' }

  it('can be a plain fixed value', () => {
    expect(apiHeaderProblem('X-Api-Version', '2022-11-28', auth)).toBeUndefined()
    expect(apiHeaderProblem('Accept', 'application/vnd.github+json', auth)).toBeUndefined()
    expect(apiHeaderProblem('Accept-Language', undefined, auth)).toBeUndefined()
  })

  it('is never the sign-in, whatever its case', () => {
    expect(apiHeaderProblem('authorization', 'x', undefined)).toBe('"authorization" is the API\'s sign-in: set it in the API\'s settings, where its secret stays in env')
    expect(apiHeaderProblem('x-shop-key', undefined, auth)).toBe('"x-shop-key" is the API\'s sign-in: set it in the API\'s settings, where its secret stays in env')
    expect(apiHeaderProblem('Proxy-Authorization', 'x', undefined)).toMatch(/sign-in/)
  })

  it('is not one the client sends itself, or a browser refuses', () => {
    for (const name of ['Cookie', 'Host', 'Content-Type', 'Content-Length', 'Connection', 'Transfer-Encoding', 'Origin', 'Sec-Fetch-Mode', 'Proxy-Connection']) {
      expect(apiHeaderProblem(name, 'x', undefined), name).toBe(`A call can't send "${name}": the app sends it itself, or the browser refuses it`)
    }
  })

  it('has a name made of letters, digits and dashes, and a value of one line of plain text', () => {
    expect(apiHeaderProblem('X Key', 'x', undefined)).toBe('Use a header name like "X-Api-Version"')
    expect(apiHeaderProblem('X-Key\r\nHost', 'x', undefined)).toBe('Use a header name like "X-Api-Version"')
    expect(apiHeaderProblem('X-Version', '2\r\nX-Evil: 1', undefined)).toBe('"X-Version": a header value is one line of plain text')
    expect(apiHeaderProblem('X-Version', '', undefined)).toBe('"X-Version": give it a value, or remove it')
  })

  it('refuses a fixed value that looks like a secret, by its name or its value', () => {
    const secret = '"X-Api-Key" looks like a secret: put it in the API\'s sign-in, where it stays in env'
    expect(apiHeaderProblem('X-Api-Key', 'abc', undefined)).toBe(secret)
    expect(apiHeaderProblem('X-Auth-Token', 'abc', undefined)).toMatch(/looks like a secret/)
    expect(apiHeaderProblem('X-Client', 'Bearer abc', undefined)).toMatch(/looks like a secret/)
    expect(apiHeaderProblem('X-Client', 'sk_live_4eC39HqLyjWDarjtT1zdp7dc', undefined)).toMatch(/looks like a secret/)
    // Filled from a parameter, the value is the page's, not the model's.
    expect(apiHeaderProblem('X-Auth-Token', undefined, undefined)).toBeUndefined()
  })
})

describe('the model keeps the header rules', () => {
  it('loads fixed headers and header parameters', () => {
    expect(messages({ queries: [query({ headers: [{ name: 'X-Api-Version', value: '2' }], params: [{ name: 'locale', in: 'header', type: 'text', key: 'Accept-Language' }] })] })).toEqual([])
  })

  it('refuses what apiHeaderProblem refuses, on a fixed header and a header parameter', () => {
    expect(messages({ queries: [query({ headers: [{ name: 'X-Shop-Key', value: 'x' }] })] })).toContain('q: "X-Shop-Key" is the API\'s sign-in: set it in the API\'s settings, where its secret stays in env')
    expect(messages({ queries: [query({ params: [{ name: 'auth', in: 'header', type: 'text', key: 'Authorization' }] })] })).toContain('q: "Authorization" is the API\'s sign-in: set it in the API\'s settings, where its secret stays in env')
    expect(messages({ actions: [{ name: 'a', method: 'POST', path: '/a', params: [], headers: [{ name: 'X-Token', value: 'abc' }] }] })).toContain('a: "X-Token" looks like a secret: put it in the API\'s sign-in, where it stays in env')
  })

  it('names a header parameter after its key, else its name, and sends each header once', () => {
    expect(messages({ queries: [query({ params: [{ name: 'tenant', in: 'header', type: 'text' }] })] })).toEqual([])
    expect(messages({ queries: [query({ headers: [{ name: 'X-A', value: '1' }, { name: 'x-a', value: '2' }] })] })).toContain('q: Two headers are named "x-a"')
    expect(messages({ queries: [query({ headers: [{ name: 'Accept-Language', value: 'en' }], params: [{ name: 'locale', in: 'header', type: 'text', key: 'accept-language' }] })] })).toContain('q: Two headers are named "accept-language"')
    expect(messages({ queries: [query({ headers: Array.from({ length: 21 }, (_, at) => ({ name: `X-H${at}`, value: '1' })) })] })).toContain('q: A call sends at most 20 headers')
  })
})

describe('api_query_set and api_action_set take headers', () => {
  const shop = () => {
    const p = project()
    p.edit('api_create', { name: 'Shop API', baseUrl: 'https://shop.example.com/v1', auth: { type: 'bearer' } })
    p.edit('api_model_set', { datasource: 'ds_shop_api', model: MODELS[0] })
    return p
  }

  it('writes them as given', () => {
    const p = shop()
    p.edit('api_query_set', { datasource: 'ds_shop_api', query: query({ headers: [{ name: 'X-Api-Version', value: '2' }], params: [{ name: 'locale', in: 'header', type: 'text', key: 'Accept-Language' }] }) })
    p.edit('api_action_set', { datasource: 'ds_shop_api', action: { name: 'add', method: 'POST', path: '/p', params: [], headers: [{ name: 'X-Shop-Channel', value: 'web' }] } })
    const saved = p.json('.bildr/datasources/shop-api.json')
    expect(saved.queries[0]).toMatchObject({ headers: [{ name: 'X-Api-Version', value: '2' }], params: [{ name: 'locale', in: 'header', key: 'Accept-Language' }] })
    expect(saved.actions[0].headers).toEqual([{ name: 'X-Shop-Channel', value: 'web' }])
  })

  it('refuses the sign-in and a secret, and writes nothing', () => {
    const p = shop()
    expect(p.refuse('api_query_set', { datasource: 'ds_shop_api', query: query({ headers: [{ name: 'Authorization', value: 'Bearer abc' }] }) }, 'invalid').message)
      .toBe('q: "Authorization" is the API\'s sign-in: set it in the API\'s settings, where its secret stays in env')
    expect(p.refuse('api_action_set', { datasource: 'ds_shop_api', action: { name: 'add', method: 'POST', path: '/p', params: [], headers: [{ name: 'X-Api-Key', value: 'k' }] } }, 'invalid').message)
      .toMatch(/looks like a secret/)
    expect(p.json('.bildr/datasources/shop-api.json').queries).toEqual([])
  })
})
