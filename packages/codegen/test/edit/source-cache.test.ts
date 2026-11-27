// codegen-architecture R5: a remote source's reads are kept a while on the server, in its memory, behind a port.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { generate } from '../../src/generate/index'
import { loadModel } from '../../src/model/load'
import { generatedRunner } from '../generate/run-generated'
import { generated } from './behaviour-helpers'
import { project } from './helpers'

const CATALOG = '.bildr/datasources/catalog.json'
const QUOTES = '.bildr/datasources/quotes.json'

describe('the cache of a remote source', () => {
  it('a server API source keeps its TTL in seconds (1 to a day, whole); null takes it away', () => {
    const p = project()
    p.edit('api_update', { datasource: 'ds_catalog', cache: { ttl: 60 } })
    expect(p.json(CATALOG).cache).toEqual({ ttl: 60 })
    for (const cache of [{ ttl: 0 }, { ttl: 86_401 }, { ttl: 1.5 }, { ttl: 5, stale: 1 }, {}]) p.refuse('api_update', { datasource: 'ds_catalog', cache }, 'invalid_input')
    p.edit('api_update', { datasource: 'ds_catalog', cache: null })
    expect(p.json(CATALOG).cache).toBeUndefined()
    p.edit('api_create', { name: 'Slow API', baseUrl: 'https://slow.example.com', cache: { ttl: 300 } })
    expect(p.json('.bildr/datasources/slow-api.json').cache).toEqual({ ttl: 300 })
  })

  it('an API called from the page has none: its queries keep their answers in the page', () => {
    const p = project()
    const message = 'An API called from the page has no server cache: its queries keep their answers in the page'
    expect(p.refuse('api_update', { datasource: 'ds_weather', cache: { ttl: 60 } }, 'invalid').message).toContain(message)
    expect(p.refuse('api_create', { name: 'Page API', baseUrl: 'https://page.example.com', runtime: 'browser', cache: { ttl: 60 } }, 'invalid').message).toBe(message)
    p.edit('api_update', { datasource: 'ds_catalog', cache: { ttl: 60 } })
    expect(p.refuse('api_update', { datasource: 'ds_catalog', runtime: 'browser', auth: null }, 'invalid').message).toContain('remove its cache (cache: null)')
    p.edit('api_update', { datasource: 'ds_catalog', runtime: 'browser', auth: null, cache: null })
    const loaded = loadModel({ ...p.files, '.bildr/datasources/weather.json': JSON.stringify({ ...p.json('.bildr/datasources/weather.json'), cache: { ttl: 5 } }) })
    expect(JSON.stringify(loaded.ok ? [] : loaded.problems)).toContain(message)
  })

  it('a REST source keeps one too; a memory source or the app database has none', () => {
    const p = project()
    p.edit('datasource_update', { datasource: 'ds_quotes', cache: { ttl: 30 } })
    expect(p.json(QUOTES).cache).toEqual({ ttl: 30 })
    p.edit('datasource_update', { datasource: 'ds_quotes', cache: null })
    expect(p.json(QUOTES).cache).toBeUndefined()
    p.edit('datasource_create', { name: 'Billing', kind: 'rest', defaults: { baseUrl: 'https://billing.example.com' }, cache: { ttl: 20 } })
    expect(p.json('.bildr/datasources/billing.json').cache).toEqual({ ttl: 20 })
    p.refuse('datasource_create', { name: 'rows', kind: 'memory', cache: { ttl: 5 } }, 'invalid')
    expect(p.refuse('datasource_update', { datasource: 'ds_main', cache: { ttl: 5 } }, 'invalid').message)
      .toBe('The app database is not called over HTTP: it takes no timeout or cache')
    const loaded = loadModel({ ...p.files, '.bildr/datasources/main.json': JSON.stringify({ ...p.json('.bildr/datasources/main.json'), cache: { ttl: 5 } }) })
    expect(JSON.stringify(loaded.ok ? [] : loaded.problems)).toContain('Only a REST or an API data source has a cache')
  })
})

describe('the generated clients', () => {
  it('a source that says a cache keeps its reads in its own answer cache; one that says none is called as it was', () => {
    const p = project()
    const before = generated(p.files)
    expect(before['layers/apis/server/utils/catalog.ts']).not.toContain('cache')
    expect(before['layers/blog/server/utils/blog.ts']).not.toContain('cachedClient')
    p.edit('api_update', { datasource: 'ds_catalog', cache: { ttl: 60 } })
    p.edit('datasource_update', { datasource: 'ds_quotes', cache: { ttl: 30 } })
    const files = generated(p.files)
    const catalog = files['layers/apis/server/utils/catalog.ts']!
    expect(catalog).toContain('import { answerCache, cachedClient } from \'#core/http/cache\'\n')
    expect(catalog).toContain('  const call = cachedClient(createHttpClient({ baseUrl: config.baseUrl, headers, unconfigured: String(config.apiKey ?? \'\').trim() === \'\', retries: 2, signal }), answerCache(\'catalog\'), 60000)\n')
    const blog = files['layers/blog/server/utils/blog.ts']!
    expect(blog).toContain('import { answerCache, cachedClient } from \'#core/http/cache\'\n')
    expect(blog).toContain('  return resultClient(cachedClient(createHttpClient({ baseUrl, headers, retries: 2, signal }), answerCache(\'quotes\'), 30000), failure => ')
  })
})

describe('a cached source\'s composition root, run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bildr-source-cache-'))
  const CONFIG = '__bildrSourceCacheConfig'
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    Reflect.deleteProperty(globalThis, CONFIG)
  })

  it('a read asked again within the TTL is not sent again, in another request too; a write makes the next read go to the API', async () => {
    const p = project()
    p.edit('api_update', { datasource: 'ds_catalog', cache: { ttl: 60 } })
    const loaded = loadModel(p.files)
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
    const { load } = generatedRunner(new Map(generate(loaded.model).map(file => [file.path, file.content])), dir, {
      'nuxt/server': `export const useRuntimeConfig = () => globalThis.${CONFIG}\nexport const createError = ({ status, message }) => Object.assign(new Error(message), { status })`
    })
    type Call = (input: unknown) => Promise<{ ok: boolean, value?: unknown }>
    const root = await load<{ useCatalogApi: (signal?: AbortSignal) => { product: Call, deleteProduct: Call } }>('layers/apis/server/utils/catalog.ts')
    Object.assign(globalThis, { [CONFIG]: { apis: { catalog: { baseUrl: 'https://shop.example.com/v1', apiKey: 'key-1' } } } })
    const sent: string[] = []
    let price = 12.5
    vi.stubGlobal('fetch', (url: unknown, init: RequestInit) => {
      sent.push(`${init.method} ${String(url)}`)
      const dto = { id: 7, name: 'Lamp', price, in_stock: true, created_at: '2026-05-01T10:00:00Z', note: null, categories: [] }
      return Promise.resolve(init.method === 'GET' ? new Response(JSON.stringify(dto)) : new Response(null, { status: 204 }))
    })
    expect(await root.useCatalogApi().product({ id: 7 })).toMatchObject({ ok: true, value: { price: 12.5 } })
    price = 20
    expect(await root.useCatalogApi(new AbortController().signal).product({ id: 7 })).toMatchObject({ ok: true, value: { price: 12.5 } })
    expect(sent).toEqual(['GET https://shop.example.com/v1/products/7'])
    expect(await root.useCatalogApi().deleteProduct({ id: 7 })).toMatchObject({ ok: true })
    expect(await root.useCatalogApi().product({ id: 7 })).toMatchObject({ ok: true, value: { price: 20 } })
    expect(sent).toEqual(['GET https://shop.example.com/v1/products/7', 'DELETE https://shop.example.com/v1/products/7', 'GET https://shop.example.com/v1/products/7'])
  })
})
