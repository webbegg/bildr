// codegen-architecture R4: a remote source says how long its calls may take, and the server tries a read again.
import { describe, expect, it } from 'vitest'
import { loadModel } from '../../src/model/load'
import { generated } from './behaviour-helpers'
import { project } from './helpers'

const CATALOG = '.bildr/datasources/catalog.json'
const QUOTES = '.bildr/datasources/quotes.json'

describe('the timeout of a remote source', () => {
  it('an API source keeps its timeout in seconds (1 to 60, whole); null takes it away', () => {
    const p = project()
    p.edit('api_update', { datasource: 'ds_catalog', timeout: 5 })
    expect(p.json(CATALOG).timeout).toBe(5)
    for (const timeout of [0, 61, 2.5]) p.refuse('api_update', { datasource: 'ds_catalog', timeout }, 'invalid_input')
    p.edit('api_update', { datasource: 'ds_catalog', timeout: null })
    expect(p.json(CATALOG).timeout).toBeUndefined()
    p.edit('api_create', { name: 'Slow API', baseUrl: 'https://slow.example.com', timeout: 30 })
    expect(p.json('.bildr/datasources/slow-api.json').timeout).toBe(30)
  })

  it('a REST source keeps one too; a memory source or the app database has none', () => {
    const p = project()
    p.edit('datasource_update', { datasource: 'ds_quotes', timeout: 3 })
    expect(p.json(QUOTES).timeout).toBe(3)
    p.edit('datasource_create', { name: 'Billing', kind: 'rest', defaults: { baseUrl: 'https://billing.example.com' }, timeout: 20 })
    expect(p.json('.bildr/datasources/billing.json').timeout).toBe(20)
    expect(p.refuse('datasource_create', { name: 'rows', kind: 'memory', timeout: 5 }, 'invalid').message)
      .toBe('A memory data source keeps its rows in the server process: it has no settings')
    expect(p.refuse('datasource_update', { datasource: 'ds_main', timeout: 5 }, 'invalid').message)
      .toBe('The app database is not called over HTTP: it takes no timeout or cache')
  })

  it('a model file that gives the app database a timeout does not load', () => {
    const p = project()
    const loaded = loadModel({ ...p.files, '.bildr/datasources/main.json': JSON.stringify({ ...p.json('.bildr/datasources/main.json'), timeout: 5 }) })
    expect(loaded.ok).toBe(false)
    expect(JSON.stringify(loaded.ok ? [] : loaded.problems)).toContain('Only a REST or an API data source has a timeout')
  })
})

describe('the generated clients', () => {
  it('a server source waits its timeout and tries a read again twice; one that says no timeout waits the client\'s 10 s', () => {
    const p = project()
    expect(generated(p.files)['layers/apis/server/utils/catalog.ts'])
      .toContain('createHttpClient({ baseUrl: config.baseUrl, headers, unconfigured: String(config.apiKey ?? \'\').trim() === \'\', retries: 2, signal })')
    p.edit('api_update', { datasource: 'ds_catalog', timeout: 5 })
    expect(generated(p.files)['layers/apis/server/utils/catalog.ts']).toContain(', timeoutMs: 5000, retries: 2, signal })')
    p.edit('datasource_update', { datasource: 'ds_quotes', timeout: 3 })
    expect(generated(p.files)['layers/blog/server/utils/blog.ts']).toContain('createHttpClient({ baseUrl, headers, timeoutMs: 3000, retries: 2, signal })')
  })

  it('a read route hands its request\'s signal to the root (the browser went away: the call stops); a write route does not (it would stop half done)', () => {
    const files = generated(project().files)
    expect(files['layers/apis/server/utils/catalog.ts']).toContain('export const useCatalogApi = (signal?: AbortSignal) => {')
    expect(files['layers/apis/server/utils/catalog.ts']).toContain('const catalogClient = (signal?: AbortSignal): ApiClient<CatalogError> => {')
    expect(files['layers/apis/server/utils/catalog.ts']).toContain(', retries: 2, signal })')
    expect(files['layers/apis/server/api/apis/catalog/product.get.ts']).toContain('await useCatalogApi(event.req.signal).product(input)')
    expect(files['layers/apis/server/api/apis/catalog/create-product.post.ts']).toContain('await useCatalogApi().createProduct(')
    expect(files['layers/blog/server/utils/blog.ts']).toContain('export const useBlog = (signal?: AbortSignal) => {')
    expect(files['layers/blog/server/utils/blog.ts']).toContain('createHttpClient({ baseUrl, headers, retries: 2, signal })')
    expect(files['layers/blog/server/api/blog/quotes/index.get.ts']).toContain('await useBlog(event.req.signal).listQuotes(page)')
    expect(files['layers/blog/server/api/blog/posts/index.post.ts']).toContain('await useBlog().createPost(')
  })

  it('a source that runs in the page waits its timeout, and does not try again itself: its query does (the browser\'s retries)', () => {
    const p = project()
    p.edit('api_update', { datasource: 'ds_weather', timeout: 4 })
    const root = generated(p.files)['layers/apis/app/data/weather.ts']!
    expect(root).toContain('createHttpClient({ baseUrl, headers: { accept: \'application/json\' }, signal, timeoutMs: 4000 })')
    expect(root).not.toContain('retries')
  })
})
