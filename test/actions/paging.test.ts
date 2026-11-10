import { describe, expect, it } from 'vitest'
import { createBildr } from '../../server/actions/runtime'
import { ACTIONS } from '../../server/actions/registry'
import { createApiFetcher } from '../../server/utils/apiFetch'
import { publicPagedRecords } from '../../server/utils/publicData'
import type { Resolver, Transport } from '../../server/utils/urlGuard'
import type { DataRecord } from '#shared/data/records'
import type { Collection, Connection, Project } from '#shared/document/schema'
import { memoryStorage } from '../helpers'

const SECRET = 'sk_live_PAGING_SECRET77'
const mcp = { caller: 'mcp' as const, source: 'mcp' }
const BASE = 'https://api.example.com/v1'
const leaks = (value: unknown) => JSON.stringify(value ?? null).includes(SECRET)

const items = (count: number) => Array.from({ length: count }, (_, i) => ({ id: i + 1, name: `Item ${i + 1}` }))
const ITEMS = items(45)
const BIG = items(5000)
const json = (body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', ...headers } })
/** Cursors with characters that would change the query or the path if not encoded. */
const cursorFor = (start: number) => `c&x=/../${start}`

const resolve: Resolver = async (host) => {
  if (host.endsWith('example.com') || host === 'evil.com') return [{ address: '93.184.216.34', family: 4 }]
  throw new Error(`getaddrinfo ENOTFOUND ${host}`)
}

interface Call { method: string, url: string, headers: Record<string, string> }

/** One fake API: each path pages the same 45 items a different way. */
function route(url: URL, list: { id: number }[]): Response {
  const q = url.searchParams
  const n = (name: string, fallback: number) => (q.has(name) ? Number(q.get(name)) : fallback)
  const path = url.pathname.replace(/^\/v1/, '')
  if (path === '/next' || path === '/nonext') {
    const page = n('page', 1)
    const next = page * 20 < list.length ? `${BASE}${path}?page=${page + 1}` : null
    return json({ info: { count: list.length, next }, results: list.slice((page - 1) * 20, page * 20) })
  }
  if (path === '/pages') {
    const size = n('per_page', 20)
    const page = n('page', 1)
    return json({ total: list.length, data: list.slice((page - 1) * size, page * size) })
  }
  if (path === '/offset') return json({ total: list.length, products: list.slice(n('skip', 0), n('skip', 0) + n('limit', 30)) })
  if (path === '/cursor') {
    const size = n('size', 20)
    const start = q.has('cursor') ? Number(q.get('cursor')!.split('/').at(-1)) : 0
    const end = start + size
    return json({ data: list.slice(start, end), meta: { next_cursor: end < list.length ? cursorFor(end) : null } })
  }
  if (path === '/link') {
    const page = n('page', 1)
    const link = page * 20 < list.length ? `</v1/link?page=${page + 1}>; rel="next"` : ''
    return json(list.slice((page - 1) * 20, page * 20), link ? { link } : {})
  }
  if (path === '/plain') return json({ data: list.slice(0, 5) })
  return json({ error: 'nope' })
}

async function setup(list: { id: number }[] = ITEMS, offSite?: (url: URL) => Response | undefined) {
  const calls: Call[] = []
  const transport: Transport = async (url, init) => {
    calls.push({ method: init.method ?? 'GET', url: url.href, headers: init.headers ?? {} })
    if (url.pathname === '/v1/down') throw new Error(`connect ECONNREFUSED (${init.headers?.['x-key']})`)
    if (init.method === 'POST') return json({ id: 999, name: 'New' })
    return offSite?.(url) ?? route(url, list)
  }
  const bildr = createBildr(memoryStorage(), ACTIONS, { api: createApiFetcher({ transport, resolve }) })
  const { id: projectId } = await bildr.call<Project>('project_create', { name: 'Paging' }, mcp)
  await bildr.call('env_set', { projectId, name: 'K', value: SECRET, secret: true }, mcp)
  const { connection } = await bildr.call<{ connection: Connection }>('connection_create', {
    projectId, name: 'Items', baseUrl: BASE, headers: [{ name: 'X-Key', value: '{{ env.K }}' }]
  }, mcp)
  const collection = async (name: string, list: object, extra: object = {}) => (await bildr.call<{ collection: Collection }>('collection_create', {
    projectId, name, fields: [{ key: 'name', type: 'text' }], source: { type: 'connection', connectionId: connection.id, endpoints: { list: { method: 'GET', ...list }, ...extra } }
  }, mcp)).collection
  const read = (slug: string, input: object = {}) => bildr.call<{ records: DataRecord[], total: number, hasMore?: boolean }>('record_list', { projectId, collection: slug, ...input }, mcp)
  const urls = () => calls.map(c => c.url.replace(BASE, ''))
  return { bildr, projectId, connection, calls, collection, read, urls }
}

const ids = (records: DataRecord[]) => records.map(r => Number(r.id))
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)
const NEXT = { path: '/next', itemsPath: 'results', paging: { type: 'next', nextPath: 'info.next', totalPath: 'info.count' } }

describe('record_list over paged lists', () => {
  it('next: follows info.next for as many pages as the window needs, with the headers', async () => {
    const ctx = await setup()
    await ctx.collection('Next', NEXT)
    const result = await ctx.read('next', { offset: 0, limit: 45 })
    expect(ids(result.records)).toEqual(range(1, 45))
    expect([result.total, result.hasMore]).toEqual([45, false])
    expect(ctx.urls()).toEqual(['/next', '/next?page=2', '/next?page=3'])
    expect(ctx.calls.every(c => c.headers['x-key'] === SECRET)).toBe(true)
  })

  it('next: stops once the window is filled, and says there is more', async () => {
    const ctx = await setup()
    await ctx.collection('Next', NEXT)
    const result = await ctx.read('next', { offset: 20, limit: 5 })
    expect(ids(result.records)).toEqual(range(21, 25))
    expect([result.total, result.hasMore]).toEqual([45, true])
    expect(ctx.urls()).toEqual(['/next', '/next?page=2'])
  })

  it('page: fetches only the pages of the window', async () => {
    const ctx = await setup()
    await ctx.collection('Pages', { path: '/pages', itemsPath: 'data', paging: { type: 'page', sizeParam: 'per_page', size: 10, totalPath: 'total' } })
    const result = await ctx.read('pages', { offset: 25, limit: 10 })
    expect(ids(result.records)).toEqual(range(26, 35))
    expect([result.total, result.hasMore]).toEqual([45, true])
    expect(ctx.urls()).toEqual(['/pages?page=3&per_page=10', '/pages?page=4&per_page=10'])
  })

  it('page: learns the page size from the first page when it has none', async () => {
    const ctx = await setup()
    await ctx.collection('Pages', { path: '/pages', itemsPath: 'data', paging: { type: 'page', start: 1 } })
    const result = await ctx.read('pages', { offset: 41, limit: 2 })
    expect(ids(result.records)).toEqual([42, 43])
    expect(ctx.urls()).toEqual(['/pages?page=1', '/pages?page=3'])
    expect([result.total, result.hasMore]).toEqual([45, false])
  })

  it('offset: jumps to the offset of the window', async () => {
    const ctx = await setup()
    await ctx.collection('Offset', { path: '/offset', itemsPath: 'products', paging: { type: 'offset', param: 'skip', size: 20, totalPath: 'total' } })
    const result = await ctx.read('offset', { offset: 40, limit: 10 })
    expect(ids(result.records)).toEqual(range(41, 45))
    expect([result.total, result.hasMore]).toEqual([45, false])
    expect(ctx.urls()).toEqual(['/offset?skip=40&limit=20'])
  })

  it('cursor: walks the pages in order, with the cursor encoded in the query', async () => {
    const ctx = await setup()
    await ctx.collection('Cursor', { path: '/cursor', itemsPath: 'data', paging: { type: 'cursor', param: 'cursor', cursorPath: 'meta.next_cursor' } })
    const result = await ctx.read('cursor', { offset: 0, limit: 30 })
    expect(ids(result.records)).toEqual(range(1, 30))
    expect(ctx.urls()).toEqual(['/cursor', '/cursor?cursor=c%26x%3D%2F..%2F20'])
    expect(new URL(ctx.calls[1]!.url).pathname).toBe('/v1/cursor')
    expect([result.total, result.hasMore]).toEqual([40, true])
  })

  it('next from the Link header, relative to the page URL', async () => {
    const ctx = await setup()
    await ctx.collection('Link', { path: '/link', paging: { type: 'next' } })
    const result = await ctx.read('link', { offset: 0, limit: 100 })
    expect(ids(result.records)).toEqual(range(1, 45))
    expect([result.total, result.hasMore]).toEqual([45, false])
    expect(ctx.urls()).toEqual(['/link', '/link?page=2', '/link?page=3'])
  })

  it('without totalPath, total is the number loaded so far and hasMore tells the rest', async () => {
    const ctx = await setup()
    await ctx.collection('No total', { ...NEXT, path: '/nonext', paging: { type: 'next', nextPath: 'info.next' } })
    expect(await ctx.read('no-total', { offset: 0, limit: 10 })).toMatchObject({ total: 20, hasMore: true })
    expect(await ctx.read('no-total', { offset: 0, limit: 100 })).toMatchObject({ total: 45, hasMore: false })
  })

  it('filters and sorts over the pages loaded from the start', async () => {
    const ctx = await setup()
    await ctx.collection('Next', NEXT)
    const result = await ctx.read('next', { filter: { name: 'Item 44' } })
    expect([ids(result.records), result.total, result.hasMore]).toEqual([[44], 1, false])
    expect(ctx.urls()).toHaveLength(3)
  })

  it('without paging, one request and the old response shape', async () => {
    const ctx = await setup()
    await ctx.collection('Plain', { path: '/next', itemsPath: 'results' })
    const result = await ctx.read('plain', { offset: 0, limit: 45 })
    expect(Object.keys(result).sort()).toEqual(['records', 'total'])
    expect([result.records.length, result.total]).toEqual([20, 20])
    expect(ctx.urls()).toEqual(['/next'])
  })
})

describe('caps', () => {
  it('reads at most 20 pages per call, cut with hasMore', async () => {
    const ctx = await setup(BIG)
    await ctx.collection('Pages', { path: '/pages', itemsPath: 'data', paging: { type: 'page', sizeParam: 'per_page', size: 10 } })
    const result = await ctx.read('pages', { offset: 0, limit: 500 })
    expect(ctx.calls).toHaveLength(20)
    expect(ids(result.records)).toEqual(range(1, 200))
    expect([result.total, result.hasMore]).toEqual([200, true])
  })

  it('reads at most 1,000 records per call, cut with hasMore', async () => {
    const ctx = await setup(BIG)
    await ctx.collection('Cursor', { path: '/cursor?size=100', itemsPath: 'data', paging: { type: 'cursor', param: 'cursor', cursorPath: 'meta.next_cursor' } })
    const result = await ctx.read('cursor', { offset: 950, limit: 100 })
    expect(ctx.calls).toHaveLength(10)
    expect(ids(result.records)).toEqual(range(951, 1000))
    expect([result.total, result.hasMore]).toEqual([1000, true])
  })

  it('stops on a next URL that repeats', async () => {
    const ctx = await setup(ITEMS, url => (url.pathname === '/v1/loop' ? json({ next: `${BASE}/loop`, data: [{ id: 1 }] }) : undefined))
    await ctx.collection('Loop', { path: '/loop', itemsPath: 'data', paging: { type: 'next', nextPath: 'next' } })
    expect(await ctx.read('loop')).toMatchObject({ total: 1, hasMore: false })
    expect(ctx.calls).toHaveLength(1)
  })
})

describe('resumable sequential paging', () => {
  const CURSOR = { path: '/cursor', itemsPath: 'data', paging: { type: 'cursor', param: 'cursor', cursorPath: 'meta.next_cursor' } }
  const walk = async (ctx: Awaited<ReturnType<typeof setup>>, slug: string) => {
    for (const [offset, limit] of [[0, 400], [400, 400], [800, 200]]) await ctx.read(slug, { offset, limit })
    ctx.calls.length = 0
  }

  for (const [type, list] of [['next', NEXT], ['cursor', CURSOR]] as const) {
    it(`${type}: a later window starts at the nearest page reached before`, async () => {
      const ctx = await setup(BIG)
      await ctx.collection('Long', list)
      await walk(ctx, 'long')
      const result = await ctx.read('long', { offset: 1000, limit: 40 })
      expect(ids(result.records)).toEqual(range(1001, 1040))
      expect(result.hasMore).toBe(true)
      expect(ctx.calls).toHaveLength(2)
      if (type === 'next') expect(ctx.urls()).toEqual(['/next?page=51', '/next?page=52'])
    })
  }

  it('with nothing remembered, walks from page 1 and returns what fits in 20 pages', async () => {
    const ctx = await setup(BIG)
    await ctx.collection('Long', NEXT)
    const result = await ctx.read('long', { offset: 1000, limit: 40 })
    expect([result.records, result.hasMore]).toEqual([[], true])
    expect(ctx.urls().slice(0, 2)).toEqual(['/next', '/next?page=2'])
    expect(ctx.calls).toHaveLength(20)
  })

  it('pages read from the cache do not count toward the 20-page cap', async () => {
    const ctx = await setup(BIG)
    await ctx.collection('Long', NEXT)
    await ctx.read('long', { offset: 0, limit: 400 })
    ctx.calls.length = 0
    const result = await ctx.read('long', { offset: 0, limit: 500 })
    expect(ids(result.records)).toEqual(range(1, 500))
    expect(ctx.urls()).toEqual(range(21, 25).map(page => `/next?page=${page}`))
  })

  it('a write forgets the pages reached', async () => {
    const ctx = await setup(BIG)
    await ctx.collection('Long', NEXT, { create: { method: 'POST', path: '/next' } })
    await walk(ctx, 'long')
    await ctx.bildr.call('record_create', { projectId: ctx.projectId, collection: 'long', values: { name: 'New' } }, mcp)
    ctx.calls.length = 0
    const result = await ctx.read('long', { offset: 1000, limit: 40 })
    expect([result.records, result.hasMore]).toEqual([[], true])
    expect(ctx.urls()[0]).toBe('/next')
    expect(ctx.calls).toHaveLength(20)
  })
})

describe('cache', () => {
  it('caches every page, and a write drops every page of the collection', async () => {
    const ctx = await setup()
    await ctx.collection('Next', NEXT, { create: { method: 'POST', path: '/next' } })
    await ctx.read('next', { offset: 0, limit: 45 })
    await ctx.read('next', { offset: 0, limit: 45 })
    expect(ctx.calls).toHaveLength(3)
    await ctx.bildr.call('record_create', { projectId: ctx.projectId, collection: 'next', values: { name: 'New' } }, mcp)
    ctx.calls.length = 0
    await ctx.read('next', { offset: 0, limit: 45 })
    expect(ctx.urls()).toEqual(['/next', '/next?page=2', '/next?page=3'])
  })
})

describe('next URLs that leave the origin', () => {
  const evil = (next: string) => (url: URL) => (url.pathname === '/v1/evil' ? json({ next, data: [{ id: 1 }] }) : url.hostname === 'evil.com' ? json({ data: [{ id: 2 }] }) : undefined)
  const OFF_SITE = 'The API\'s next page is on another site'

  for (const [name, next] of [
    ['an absolute URL on another host', 'https://evil.com/v1/evil?page=2'],
    ['a protocol-relative URL', '//evil.com/x'],
    ['a user-info trick', 'https://api.example.com@evil.com/x'],
    ['another scheme', 'http://api.example.com/v1/evil?page=2'],
    ['another port', 'https://api.example.com:8443/v1/evil?page=2']
  ]) {
    it(`refuses ${name}, sending nothing there`, async () => {
      const ctx = await setup(ITEMS, evil(next!))
      await ctx.collection('Evil', { path: '/evil', itemsPath: 'data', paging: { type: 'next', nextPath: 'next' } })
      await expect(ctx.read('evil', { limit: 10 })).rejects.toMatchObject({ code: 'invalid', message: OFF_SITE })
      expect(ctx.urls()).toEqual(['/evil'])
    })
  }

  it('a same-origin next page that redirects to another host gets no connection header', async () => {
    const ctx = await setup(ITEMS, (url) => {
      if (url.pathname === '/v1/evil') return json({ next: '/v1/hop', data: [{ id: 1 }] })
      if (url.pathname === '/v1/hop') return new Response(null, { status: 302, headers: { location: 'https://evil.com/steal' } })
      if (url.hostname === 'evil.com') return json({ data: [{ id: 2 }] })
      return undefined
    })
    await ctx.collection('Evil', { path: '/evil', itemsPath: 'data', paging: { type: 'next', nextPath: 'next' } })
    await ctx.read('evil', { limit: 10 })
    const offSite = ctx.calls.filter(c => new URL(c.url).hostname === 'evil.com')
    expect(offSite).toHaveLength(1)
    expect(offSite[0]!.headers['x-key']).toBeUndefined()
    expect(leaks(offSite)).toBe(false)
  })

  it('an api source next URL must stay on the source URL\'s origin', async () => {
    const ctx = await setup(ITEMS, evil('https://evil.com/x'))
    await ctx.bildr.call('collection_create', {
      projectId: ctx.projectId, name: 'Feed', fields: [{ key: 'name', type: 'text' }],
      source: { type: 'api', url: `${BASE}/evil`, itemsPath: 'data', headers: [{ name: 'X-Key', value: '{{ env.K }}' }], paging: { type: 'next', nextPath: 'next' } }
    }, mcp)
    await expect(ctx.read('feed', { limit: 10 })).rejects.toMatchObject({ code: 'invalid', message: OFF_SITE })
    expect(ctx.urls()).toEqual(['/evil'])
  })
})

describe('api sources', () => {
  it('page through the same paging', async () => {
    const ctx = await setup()
    await ctx.bildr.call('collection_create', {
      projectId: ctx.projectId, name: 'Feed', fields: [{ key: 'name', type: 'text' }],
      source: { type: 'api', url: `${BASE}/next`, itemsPath: 'results', paging: NEXT.paging }
    }, mcp)
    const result = await ctx.read('feed', { offset: 30, limit: 15 })
    expect(ids(result.records)).toEqual(range(31, 45))
    expect([result.total, result.hasMore]).toEqual([45, false])
    expect(ctx.urls()).toEqual(['/next', '/next?page=2', '/next?page=3'])
  })
})

describe('record_get without a get endpoint', () => {
  it('scans the list pages', async () => {
    const ctx = await setup()
    await ctx.collection('Next', NEXT)
    const record = await ctx.bildr.call<DataRecord>('record_get', { projectId: ctx.projectId, collection: 'next', recordId: '30' }, mcp)
    expect(record.values).toEqual({ name: 'Item 30' })
    await expect(ctx.bildr.call('record_get', { projectId: ctx.projectId, collection: 'next', recordId: '99' }, mcp)).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('public reads', () => {
  it('fill a limit of 100 across pages', async () => {
    const ctx = await setup(BIG)
    const collection = await ctx.collection('Next', { ...NEXT, paging: { type: 'next', nextPath: 'info.next' } })
    const project = await ctx.bildr.call<Project>('project_get', { projectId: ctx.projectId }, mcp)
    const load = (offset: number, limit: number) => ctx.bildr.services.collectionPage(ctx.projectId, collection, project.connections, { offset, limit })
    const result = await publicPagedRecords(collection, load, { limit: '100', offset: '10' })
    expect('records' in result && ids(result.records)).toEqual(range(11, 110))
    expect(ctx.calls).toHaveLength(6)
    expect(await publicPagedRecords(collection, load, { limit: 'x' })).toEqual({ problem: '"limit" must be a whole number from 1' })
  })
})

describe('detection in the test actions', () => {
  it('endpoint_test proposes paging and samples page two', async () => {
    const ctx = await setup()
    const result = await ctx.bildr.call<{ paging: unknown, pageTwo: { sample: DataRecord[], count: number } }>('endpoint_test', {
      projectId: ctx.projectId, connectionId: ctx.connection.id, method: 'GET', path: '/next'
    }, mcp)
    expect(result.paging).toEqual({ type: 'next', nextPath: 'info.next', totalPath: 'info.count' })
    expect(result.pageTwo.count).toBe(20)
    expect(result.pageTwo.sample[0]!.id).toBe('21')
    expect(ctx.urls()).toEqual(['/next', '/next?page=2'])
  })

  it('endpoint_test tests a given paging, and reports a refused page two without failing', async () => {
    const ctx = await setup(ITEMS, url => (url.pathname === '/v1/evil' ? json({ next: 'https://evil.com/x', data: [{ id: 1 }] }) : undefined))
    const pages = await ctx.bildr.call<{ pageTwo: { sample: DataRecord[] } }>('endpoint_test', {
      projectId: ctx.projectId, connectionId: ctx.connection.id, method: 'GET', path: '/pages', paging: { type: 'page', sizeParam: 'per_page', size: 5 }
    }, mcp)
    expect(pages.pageTwo.sample.map(r => r.id)).toEqual(['6', '7', '8', '9', '10'])
    const evil = await ctx.bildr.call<{ paging: unknown, pageTwo: unknown }>('endpoint_test', { projectId: ctx.projectId, connectionId: ctx.connection.id, method: 'GET', path: '/evil' }, mcp)
    expect(evil).toMatchObject({ paging: { type: 'next', nextPath: 'next' }, pageTwo: { error: 'The API\'s next page is on another site' } })
    expect(ctx.calls.some(c => c.url.includes('evil.com'))).toBe(false)
  })

  it('endpoint_test has no page two for other methods or plain lists', async () => {
    const ctx = await setup()
    const plain = await ctx.bildr.call<object>('endpoint_test', { projectId: ctx.projectId, connectionId: ctx.connection.id, method: 'GET', path: '/plain' }, mcp)
    expect(plain).toMatchObject({ paging: null })
    expect(plain).not.toHaveProperty('pageTwo')
    ctx.calls.length = 0
    const posted = await ctx.bildr.call<object>('endpoint_test', { projectId: ctx.projectId, connectionId: ctx.connection.id, method: 'POST', path: '/next', confirm: true }, mcp)
    expect(posted).not.toHaveProperty('pageTwo')
    expect(ctx.calls).toHaveLength(1)
  })

  it('api_source_preview proposes paging and samples page two', async () => {
    const ctx = await setup()
    const result = await ctx.bildr.call<{ paging: unknown, pageTwo: { sample: DataRecord[], count: number } }>('api_source_preview', { projectId: ctx.projectId, url: `${BASE}/link` }, mcp)
    expect(result.paging).toEqual({ type: 'next' })
    expect(result.pageTwo.sample[0]!.id).toBe('21')
    expect(ctx.urls()).toEqual(['/link', '/link?page=2'])
    expect(result).not.toHaveProperty('pagingTotal')
  })

  it('api_source_preview fetches page one with the given paging, so page two follows it', async () => {
    const ctx = await setup()
    const result = await ctx.bildr.call<{ items: { id: number }[], pageTwo: { sample: DataRecord[] } }>('api_source_preview', {
      projectId: ctx.projectId, url: `${BASE}/pages`, itemsPath: 'data', paging: { type: 'page', sizeParam: 'per_page', size: 5 }
    }, mcp)
    expect(result.items.map(item => item.id)).toEqual(range(1, 5))
    expect(result.pageTwo.sample.map(r => r.id)).toEqual(['6', '7', '8', '9', '10'])
    expect(ctx.urls()).toEqual(['/pages?page=1&per_page=5', '/pages?page=2&per_page=5'])
  })

  it('both test actions return the API\'s total when the paging has a totalPath', async () => {
    const ctx = await setup(BIG)
    const tested = await ctx.bildr.call<{ total: number, pagingTotal: number }>('endpoint_test', { projectId: ctx.projectId, connectionId: ctx.connection.id, method: 'GET', path: '/next' }, mcp)
    expect([tested.total, tested.pagingTotal]).toEqual([20, 5000])
    const preview = await ctx.bildr.call<{ total: number, pagingTotal: number }>('api_source_preview', {
      projectId: ctx.projectId, url: `${BASE}/pages`, itemsPath: 'data', paging: { type: 'page', sizeParam: 'per_page', size: 10, totalPath: 'total' }
    }, mcp)
    expect([preview.total, preview.pagingTotal]).toEqual([10, 5000])
  })
})

describe('paging leak checks', () => {
  it('never shows the secret in a failed page', async () => {
    const ctx = await setup(ITEMS, url => (url.pathname === '/v1/evil' ? json({ next: '/v1/down', data: [{ id: 1 }] }) : undefined))
    await ctx.collection('Evil', { path: '/evil', itemsPath: 'data', paging: { type: 'next', nextPath: 'next' } })
    const error = await ctx.read('evil', { limit: 10 }).then(() => undefined, (e: Error) => e)
    expect(error).toMatchObject({ code: 'invalid' })
    expect(error!.message).toContain('Could not reach the API')
    expect(leaks(error!.message)).toBe(false)
    const tested = await ctx.bildr.call('endpoint_test', { projectId: ctx.projectId, connectionId: ctx.connection.id, method: 'GET', path: '/evil' }, mcp)
    expect(tested).toMatchObject({ pageTwo: { error: expect.stringContaining('Could not reach the API') } })
    expect(leaks(tested)).toBe(false)
  })
})
