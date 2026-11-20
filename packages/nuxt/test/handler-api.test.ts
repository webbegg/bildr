// Simple data P4 (S4, S6, S8): `api_try` sends one call of an API data source through the remote guards and proposes
// the models of its answer; writes need `confirm`, a secret is never echoed, a browser source is tried without auth.
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createProject } from '../../create-bildr/src/create'
import { createBildrHandler } from '../src/server/handler'

const TOKEN = 'a'.repeat(48)
const SECRET = 'sk-test-secret-1234'
let root: string
let dir: string
let handle: ReturnType<typeof createBildrHandler>
let server: Server
let base: string
let seen: { method?: string, url?: string, authorization?: string | string[], body?: string }[]

const PRODUCTS = [
  { id: 1, title: 'Lamp', unit_price: 9.5, tags: ['home'], stock: null },
  { id: 2, title: 'Desk', unit_price: 120, tags: [], stock: 3, maker: { name: 'Acme' } }
]

beforeAll(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(chunk as Buffer))
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      seen.push({ method: request.method, url: request.url, authorization: request.headers.authorization ?? request.headers['x-api-key'], body })
      const json = (status: number, value: unknown) => {
        response.writeHead(status, { 'content-type': 'application/json' })
        response.end(JSON.stringify(value))
      }
      const url = new URL(request.url!, 'http://stub')
      const auth = request.headers.authorization ?? request.headers['x-api-key'] ?? null
      if (url.pathname === '/v1/products') return json(200, { data: PRODUCTS, total: 2, query: Object.fromEntries(url.searchParams) })
      if (url.pathname.startsWith('/v1/products/')) return json(200, { id: decodeURIComponent(url.pathname.slice('/v1/products/'.length)), title: 'Lamp', unit_price: 9.5 })
      if (url.pathname === '/v1/echo') return json(200, { method: request.method, body: body ? JSON.parse(body) as unknown : null, authorization: auth, query: Object.fromEntries(url.searchParams) })
      if (url.pathname === '/v1/alt/who') return json(200, { who: 'alt' })
      if (url.pathname === '/v1/away') {
        response.writeHead(302, { location: 'http://example.invalid/steal' })
        return response.end()
      }
      if (url.pathname === '/v1/around') {
        response.writeHead(302, { location: '/v1/echo' })
        return response.end()
      }
      if (url.pathname === '/v1/text') {
        response.writeHead(200, { 'content-type': 'text/plain' })
        return response.end(`hello ${auth ?? ''}`)
      }
      return json(404, { error: 'not found' })
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
})
afterAll(() => {
  server.closeAllConnections()
  server.close()
})

beforeEach(() => {
  seen = []
  root = mkdtempSync(join(tmpdir(), 'bildr-handler-api-'))
  dir = join(root, 'app')
  createProject(dir, { name: 'App', database: 'none' })
  handle = createBildrHandler({ root: dir, token: TOKEN })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const act = (name: string, body: unknown = {}) => handle(new Request(`http://localhost:3000/__bildr/api/actions/${name}`, {
  method: 'POST',
  body: JSON.stringify(body),
  headers: { 'host': 'localhost:3000', 'origin': 'http://localhost:3000', 'x-bildr-token': TOKEN, 'content-type': 'application/json' }
}), { remoteAddress: '127.0.0.1' })
const ok = async (name: string, body: unknown = {}): Promise<Json> => {
  const response = await act(name, body)
  const json = await response.json() as { ok: boolean, result?: Json }
  expect(json.ok, `${name}: ${JSON.stringify(json)}`).toBe(true)
  return json.result!
}
const failure = async (name: string, body: unknown, status: number, code: string) => {
  const response = await act(name, body)
  const json = await response.json() as { ok: boolean, code: string, message: string }
  expect(response.status, JSON.stringify(json)).toBe(status)
  expect(json.code).toBe(code)
  return json
}

const apiSource = async (extra: Record<string, unknown> = {}) => {
  await ok('api_create', { name: 'stub', baseUrl: base, ...extra })
}
const withShop = async () => {
  await apiSource()
  await ok('api_model_set', {
    datasource: 'ds_stub',
    model: { name: 'Product', fields: [{ name: 'id', type: 'integer' }, { name: 'title', type: 'text' }] }
  })
  await ok('api_query_set', {
    datasource: 'ds_stub',
    query: {
      name: 'listProducts', path: '/products',
      params: [{ name: 'maxItems', in: 'query', type: 'integer', key: 'limit' }],
      result: { model: 'Product', many: true, itemsPath: 'data' }
    }
  })
  await ok('api_action_set', {
    datasource: 'ds_stub',
    action: { name: 'createProduct', method: 'POST', path: '/echo', params: [], body: { model: 'Product' }, result: { model: 'Product', many: false } }
  })
}

describe('api_try: a GET', () => {
  it('fills path params (encoded) and query params, detects the items and proposes the models', async () => {
    await apiSource()
    const list = await ok('api_try', { datasource: 'ds_stub', path: '/products', params: { limit: 2 } })
    expect(list).toMatchObject({ status: 200, url: `${base}/products?limit=2`, items: { path: 'data', count: 2 }, json: { total: 2, query: { limit: '2' } } })
    expect(list.proposal.result).toEqual({ model: 'Product', many: true, itemsPath: 'data' })
    // Nested first, the root last: api_model_set takes them in this order (verify P4).
    expect(list.proposal.models.map((model: Json) => model.name)).toEqual(['Maker', 'Product'])
    for (const model of list.proposal.models) await ok('api_model_set', { datasource: 'ds_stub', model })
    await ok('api_query_set', { datasource: 'ds_stub', query: { name: 'tried', path: '/products', result: list.proposal.result } })
    expect(list.proposal.models[1].fields).toEqual([
      { name: 'id', type: 'integer' },
      { name: 'title', type: 'text' },
      { name: 'unitPrice', type: 'number', key: 'unit_price' },
      { name: 'tags', type: 'text', list: true },
      { name: 'stock', type: 'integer', nullable: true },
      { name: 'maker', type: 'model', model: 'Maker', optional: true }
    ])
    expect(seen.map(call => call.url)).toEqual(['/v1/products?limit=2'])

    const one = await ok('api_try', { datasource: 'ds_stub', path: '/products/:id', params: { id: 'a b' }, model: 'Item' })
    expect(one.url).toBe(`${base}/products/a%20b`)
    expect(one.json.id).toBe('a b')
    expect(one.items).toBeUndefined()
    expect(one.proposal.result).toEqual({ model: 'Item', many: false })
  })

  it('tries a saved query: params by their remote key, the saved model and itemsPath', async () => {
    await withShop()
    const tried = await ok('api_try', { datasource: 'ds_stub', query: 'listProducts', params: { maxItems: 1 } })
    expect(tried).toMatchObject({ status: 200, url: `${base}/products?limit=1`, items: { path: 'data', count: 2 }, json: { query: { limit: '1' } } })
    expect(tried.proposal.result).toEqual({ model: 'Product', many: true, itemsPath: 'data' })
    expect((await failure('api_try', { datasource: 'ds_stub', query: 'nope' }, 404, 'not_found')).message).toBe('No query "nope" in stub')
    expect((await failure('api_try', { datasource: 'ds_stub', query: 'listProducts', params: { other: 1 } }, 400, 'invalid_input')).message).toBe('listProducts has no parameter "other"')
  })

  it('answers text for a non-JSON body, with no proposal', async () => {
    await apiSource()
    expect(await ok('api_try', { datasource: 'ds_stub', path: '/text' })).toEqual({ status: 200, url: `${base}/text`, text: 'hello ' })
  })

  it('reads the base URL from the env var when it is set (it wins over the model)', async () => {
    await apiSource()
    writeFileSync(join(dir, '.env'), `NUXT_DATASOURCES_STUB_BASE_URL=${base}/alt\n`)
    expect((await ok('api_try', { datasource: 'ds_stub', path: '/who' })).json).toEqual({ who: 'alt' })
  })

  it('asks for exactly one of path, query and action, and for the path params', async () => {
    await withShop()
    expect((await failure('api_try', { datasource: 'ds_stub' }, 400, 'invalid_input')).message).toContain('Give one of path, query or action')
    expect((await failure('api_try', { datasource: 'ds_stub', path: '/echo', query: 'listProducts' }, 400, 'invalid_input')).message).toContain('Give one of path, query or action')
    expect((await failure('api_try', { datasource: 'ds_stub', path: '/products/:id' }, 400, 'invalid_input')).message).toBe('Give the path parameter "id"')
    expect((await failure('api_try', { datasource: 'ds_stub', path: '/echo', body: { a: 1 } }, 400, 'invalid_input')).message).toBe('A GET has no body')
  })

  it('a parameter named like an object member is missing when not given (review P4)', async () => {
    await withShop()
    expect((await failure('api_try', { datasource: 'ds_stub', path: '/items/:constructor' }, 400, 'invalid_input')).message).toBe('Give the path parameter "constructor"')
    await ok('api_query_set', { datasource: 'ds_stub', query: { name: 'byToString', path: '/items/:toString', params: [{ name: 'toString', in: 'path', type: 'text' }], result: { model: 'Product', many: false } } })
    expect((await failure('api_try', { datasource: 'ds_stub', query: 'byToString' }, 400, 'invalid_input')).message).toBe('Give the path parameter "toString"')
    expect(seen).toEqual([])
  })
})

describe('api_try: a write', () => {
  it('sends a saved action with confirm and its JSON body', async () => {
    await withShop()
    const tried = await ok('api_try', { datasource: 'ds_stub', action: 'createProduct', body: { id: 3, title: 'Chair' }, confirm: true })
    expect(tried).toMatchObject({ status: 200, url: `${base}/echo`, json: { method: 'POST', body: { id: 3, title: 'Chair' } } })
    expect(seen.map(call => `${call.method} ${call.url} ${call.body}`)).toEqual(['POST /v1/echo {"id":3,"title":"Chair"}'])
    expect(tried.proposal.result).toEqual({ model: 'Product', many: false })
  })

  it('refuses a non-GET without confirm: true, and sends nothing', async () => {
    await withShop()
    const message = 'api_try sends a POST: it could change the API\'s data. Pass confirm: true to send it'
    expect((await failure('api_try', { datasource: 'ds_stub', action: 'createProduct', body: { id: 3 } }, 403, 'forbidden')).message).toBe(message)
    expect((await failure('api_try', { datasource: 'ds_stub', action: 'createProduct', body: { id: 3 }, confirm: false }, 403, 'forbidden')).message).toBe(message)
    expect((await failure('api_try', { datasource: 'ds_stub', path: '/echo', method: 'DELETE' }, 403, 'forbidden')).message).toBe('api_try sends a DELETE: it could change the API\'s data. Pass confirm: true to send it')
    expect(seen).toEqual([])
  })

  it('keeps a saved operation\'s method', async () => {
    await withShop()
    expect((await failure('api_try', { datasource: 'ds_stub', action: 'createProduct', method: 'PUT', confirm: true }, 400, 'invalid_input')).message).toBe('createProduct is a POST: drop the method')
  })
})

describe('api_try: the guards', () => {
  it('refuses a redirect off the base URL, and any redirect of a write', async () => {
    await apiSource()
    expect((await failure('api_try', { datasource: 'ds_stub', path: '/away' }, 502, 'upstream')).message).toBe('The data source redirected to http://example.invalid, outside its base URL: not followed')
    expect((await ok('api_try', { datasource: 'ds_stub', path: '/around' })).json.method).toBe('GET')
    expect((await failure('api_try', { datasource: 'ds_stub', path: '/around', method: 'POST', confirm: true }, 502, 'upstream')).message).toBe('The data source redirected a POST: not followed')
    expect((await failure('api_try', { datasource: 'ds_stub', path: '/away', method: 'POST', confirm: true }, 502, 'upstream')).message).toBe('The data source redirected to http://example.invalid, outside its base URL: not followed')
    expect(seen.filter(call => call.url === '/v1/echo')).toHaveLength(1)
  })

  it('refuses paths that leave the base URL', async () => {
    await apiSource()
    expect((await failure('api_try', { datasource: 'ds_stub', path: '/../admin' }, 400, 'invalid_input')).message).toBe('The path can\'t leave the data source\'s base URL')
    expect((await failure('api_try', { datasource: 'ds_stub', path: '/products/:id', params: { id: '..' } }, 400, 'invalid_input')).message).toBe('The path can\'t leave the data source\'s base URL')
  })

  it('refuses an unknown data source and one that is not an API', async () => {
    await ok('datasource_create', { name: 'rest', kind: 'rest', defaults: { baseUrl: base } })
    expect((await failure('api_try', { datasource: 'ds_nope', path: '/echo' }, 404, 'not_found')).message).toBe('No data source "ds_nope"')
    expect((await failure('api_try', { datasource: 'ds_rest', path: '/echo' }, 400, 'invalid_input')).message).toBe('ds_rest is a rest data source: only API sources can be tried')
    expect(seen).toEqual([])
  })
})

describe('api_try: secrets', () => {
  it('sends the auth from the env and never echoes the secret: not in the url, json, text or errors', async () => {
    await apiSource({ auth: { type: 'bearer' } })
    writeFileSync(join(dir, '.env'), `NUXT_DATASOURCES_STUB_API_KEY="${SECRET}"\n`)
    const echoed = await ok('api_try', { datasource: 'ds_stub', path: '/echo', params: { token: SECRET } })
    expect(seen[0]!.authorization).toBe(`Bearer ${SECRET}`)
    expect(echoed.json.authorization).toBe('Bearer •••')
    expect(echoed.json.query.token).toBe('•••')
    expect(echoed.url).toBe(`${base}/echo?token=•••`)
    expect(JSON.stringify(echoed)).not.toContain(SECRET)
    const text = await ok('api_try', { datasource: 'ds_stub', path: '/text' })
    expect(text.text).toBe('hello Bearer •••')
    expect(JSON.stringify(text)).not.toContain(SECRET)
    const missing = await ok('api_try', { datasource: 'ds_stub', path: `/${SECRET}/x` })
    expect(missing).toEqual({ status: 404, url: `${base}/•••/x`, json: { error: 'not found' } })
  })

  it('tries a browser source without auth: the secret is never sent', async () => {
    await apiSource({ auth: { type: 'header', header: 'X-Api-Key' } })
    writeFileSync(join(dir, '.env'), `NUXT_DATASOURCES_STUB_API_KEY="${SECRET}"\n`)
    await ok('api_try', { datasource: 'ds_stub', path: '/echo' })
    expect(seen[0]!.authorization).toBe(SECRET)
    await ok('api_update', { datasource: 'ds_stub', runtime: 'browser', auth: null })
    await ok('api_try', { datasource: 'ds_stub', path: '/echo' })
    expect(seen[1]!.authorization).toBeUndefined()
  })
})
