import { describe, expect, it } from 'vitest'
import { createApiFetcher } from '../../server/utils/apiFetch'
import type { Resolver, Transport } from '../../server/utils/urlGuard'

const resolve: Resolver = async host => (host === 'internal.example.com' ? [{ address: '10.0.0.1', family: 4 }] : [{ address: '93.184.216.34', family: 4 }])
const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { ...init, headers: { 'content-type': 'application/json; charset=utf-8', ...init.headers } })

function fetcher(respond: Transport, options: { now?: () => number, sleep?: (ms: number) => Promise<void>, timeoutMs?: number, maxBytes?: number, maxEntries?: number } = {}) {
  const calls: { url: string, headers?: Record<string, string> }[] = []
  const transport: Transport = (url, init) => {
    calls.push({ url: url.href, headers: init.headers })
    return respond(url, init)
  }
  return { api: createApiFetcher({ resolve, transport, ...options }), calls }
}

describe('createApiFetcher', () => {
  it('GETs JSON with an accept header', async () => {
    const { api, calls } = fetcher(async () => json({ results: [] }))
    expect((await api.fetchJson('https://api.example.com/x')).json).toEqual({ results: [] })
    expect(calls[0]!.headers).toMatchObject({ accept: 'application/json' })
  })

  it('caches a URL for 60 s', async () => {
    let now = 0
    const { api, calls } = fetcher(async () => json([1]), { now: () => now })
    await api.fetchJson('https://api.example.com/x')
    now = 59_000
    await api.fetchJson('https://api.example.com/x')
    expect(calls).toHaveLength(1)
    now = 61_000
    await api.fetchJson('https://api.example.com/x')
    expect(calls).toHaveLength(2)
  })

  it('keeps a bounded number of cached URLs, dropping the oldest', async () => {
    const { api, calls } = fetcher(async () => json([1]), { maxEntries: 2 })
    for (const path of ['a', 'b', 'c', 'a']) await api.fetchJson(`https://api.example.com/${path}`)
    expect(calls.map(c => c.url.slice(-1))).toEqual(['a', 'b', 'c', 'a'])
  })

  it('times out', async () => {
    const { api } = fetcher((_url, { signal }) => new Promise((_resolve, reject) => {
      signal!.addEventListener('abort', () => reject(signal!.reason))
    }), { timeoutMs: 30 })
    await expect(api.fetchJson('https://api.example.com/slow')).rejects.toMatchObject({ code: 'invalid', message: 'The API did not answer within 0.03 s' })
  })

  it('refuses a response over the size cap while streaming', async () => {
    let pulled = 0
    const { api } = fetcher(async () => new Response(new ReadableStream({
      pull(controller) {
        pulled += 1
        controller.enqueue(new TextEncoder().encode(`[${'1,'.repeat(500)}`))
        if (pulled > 1000) controller.close()
      }
    }), { headers: { 'content-type': 'application/json' } }), { maxBytes: 4096 })
    await expect(api.fetchJson('https://api.example.com/big')).rejects.toMatchObject({ code: 'invalid', message: 'The API response is larger than 4 KB' })
    expect(pulled).toBeLessThan(10)
  })

  it('refuses a declared oversize body before reading it', async () => {
    const { api } = fetcher(async () => json([], { headers: { 'content-length': String(2 * 1024 * 1024) } }))
    await expect(api.fetchJson('https://api.example.com/big')).rejects.toMatchObject({ message: 'The API response is larger than 1 MB' })
  })

  it('refuses non-JSON responses', async () => {
    const html = fetcher(async () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } }))
    await expect(html.api.fetchJson('https://api.example.com/page')).rejects.toMatchObject({ code: 'invalid', message: 'The API response is not JSON' })
    const broken = fetcher(async () => new Response('{"a":', { headers: { 'content-type': 'application/json' } }))
    await expect(broken.api.fetchJson('https://api.example.com/broken')).rejects.toMatchObject({ message: 'The API response is not JSON' })
  })

  it('reports HTTP errors, blocked addresses and network failures', async () => {
    const notFound = fetcher(async () => json({ error: 'nope' }, { status: 404 }))
    await expect(notFound.api.fetchJson('https://api.example.com/missing')).rejects.toMatchObject({ code: 'invalid', message: 'The API answered HTTP 404' })
    const { api, calls } = fetcher(async () => json([]))
    await expect(api.fetchJson('https://internal.example.com/')).rejects.toMatchObject({ message: expect.stringContaining('Blocked address') })
    expect(calls).toHaveLength(0)
    const down = fetcher(async () => {
      throw new Error('connect ECONNREFUSED')
    })
    await expect(down.api.fetchJson('https://api.example.com/')).rejects.toMatchObject({ code: 'invalid', message: 'Could not reach the API: connect ECONNREFUSED' })
  })

  it('sends custom headers next to its own', async () => {
    const { api, calls } = fetcher(async () => json([]))
    await api.fetchJson('https://api.example.com/x', { headers: { authorization: 'Bearer k1' } })
    expect(calls[0]!.headers).toEqual({ 'accept': 'application/json', 'user-agent': 'bildr', 'authorization': 'Bearer k1' })
  })

  it('caches per URL and headers', async () => {
    const { api, calls } = fetcher(async () => json([1]))
    await api.fetchJson('https://api.example.com/x', { headers: { authorization: 'Bearer k1' } })
    await api.fetchJson('https://api.example.com/x', { headers: { authorization: 'Bearer k1' } })
    await api.fetchJson('https://api.example.com/x', { headers: { authorization: 'Bearer k2' } })
    await api.fetchJson('https://api.example.com/x')
    expect(calls.map(c => c.headers?.authorization)).toEqual(['Bearer k1', 'Bearer k2', undefined])
  })

  it('forgets a cached URL on invalidate', async () => {
    const { api, calls } = fetcher(async () => json([1]))
    const headers = { authorization: 'Bearer k1' }
    await api.fetchJson('https://api.example.com/x', { headers })
    await api.invalidate('https://api.example.com/x', { headers })
    await api.fetchJson('https://api.example.com/x', { headers })
    expect(calls).toHaveLength(2)
  })

  it('sends writes with a JSON body, never cached', async () => {
    const seen: { method?: string, body?: string, headers?: Record<string, string> }[] = []
    const { api } = fetcher(async (_url, init) => {
      seen.push({ method: init.method, body: init.body, headers: init.headers })
      return json({ id: 101 }, { status: 201 })
    })
    const write = () => api.send('https://api.example.com/posts', { method: 'POST', headers: { 'x-key': 'k' }, body: { title: 'Hi' } })
    expect(await write()).toEqual({ status: 201, json: { id: 101 } })
    await write()
    expect(seen).toHaveLength(2)
    expect(seen[0]).toEqual({ method: 'POST', body: '{"title":"Hi"}', headers: { 'accept': 'application/json', 'user-agent': 'bildr', 'content-type': 'application/json', 'x-key': 'k' } })
  })

  it('reads an empty or non-JSON write response as null and reports HTTP errors', async () => {
    const empty = fetcher(async () => new Response(null, { status: 204 }))
    expect(await empty.api.send('https://api.example.com/posts/1', { method: 'DELETE' })).toEqual({ status: 204, json: null })
    const text = fetcher(async () => new Response('deleted', { headers: { 'content-type': 'text/plain' } }))
    expect(await text.api.send('https://api.example.com/posts/1', { method: 'DELETE' })).toEqual({ status: 200, json: null })
    const failed = fetcher(async () => json({}, { status: 500 }))
    await expect(failed.api.send('https://api.example.com/posts', { method: 'POST', body: {} })).rejects.toMatchObject({ code: 'invalid', message: 'The API answered HTTP 500' })
  })

  describe('rate limits (HTTP 429)', () => {
    const NOW = Date.parse('2026-11-10T12:00:00Z')
    const limited = (retryAfter: string[]) => {
      const waits: number[] = []
      const answers = [...retryAfter]
      const { api, calls } = fetcher(async () => (answers.length ? json({}, { status: 429, headers: { 'retry-after': answers.shift()! } }) : json([1])), {
        now: () => NOW,
        sleep: async (ms) => {
          waits.push(ms)
        }
      })
      return { api, calls, waits }
    }

    it('a GET waits a short Retry-After in seconds and retries once', async () => {
      const { api, calls, waits } = limited(['2'])
      expect((await api.fetchJson('https://api.example.com/x')).json).toEqual([1])
      expect([waits, calls.length]).toEqual([[2000], 2])
    })

    it('a GET waits a short Retry-After given as an HTTP date', async () => {
      const { api, waits } = limited([new Date(NOW + 3000).toUTCString()])
      await api.fetchJson('https://api.example.com/x')
      expect(waits).toEqual([3000])
    })

    it('fails without waiting when the wait is over 5 s, and after one retry', async () => {
      const long = limited(['30'])
      await expect(long.api.fetchJson('https://api.example.com/x')).rejects.toMatchObject({ code: 'invalid', message: 'The API is rate limiting requests; try again in 30 s' })
      expect([long.waits, long.calls.length]).toEqual([[], 1])
      const twice = limited(['1', '4'])
      await expect(twice.api.fetchJson('https://api.example.com/x')).rejects.toMatchObject({ message: 'The API is rate limiting requests; try again in 4 s' })
      expect([twice.waits, twice.calls.length]).toEqual([[1000], 2])
    })

    it('never retries a write', async () => {
      const { api, calls, waits } = limited(['1'])
      await expect(api.send('https://api.example.com/posts', { method: 'POST', body: {} })).rejects.toMatchObject({ message: 'The API is rate limiting requests; try again in 1 s' })
      expect([waits, calls.length]).toEqual([[], 1])
    })
  })

  describe('the page index of paged lists', () => {
    const paging = { type: 'page', param: 'page', start: 1, sizeParam: 'per_page', size: 1 } as const
    const pages = (api: ReturnType<typeof fetcher>['api'], path: string, offset: number) => api.fetchPages(`https://api.example.com/${path}`, { paging, origin: 'https://api.example.com', offset, limit: 1 })

    it('keeps at most 100 pages per list, dropping the oldest from the cache', async () => {
      const { api, calls } = fetcher(async () => json([1]), { maxEntries: 500 })
      for (let offset = 0; offset <= 100; offset++) await pages(api, 'a', offset)
      calls.length = 0
      await pages(api, 'a', 100)
      await pages(api, 'a', 0)
      expect(calls.map(c => c.url)).toEqual(['https://api.example.com/a?page=1&per_page=1'])
    })

    it('a list dropped from the index loses its cached pages, so a write cannot leave them stale', async () => {
      const { api, calls } = fetcher(async url => (url.pathname === '/a' ? json([1]) : json({}, { status: 500 })), { maxEntries: 2 })
      await pages(api, 'a', 0)
      for (const path of ['b', 'c']) await expect(pages(api, path, 0)).rejects.toMatchObject({ code: 'invalid' })
      calls.length = 0
      await pages(api, 'a', 0)
      expect(calls).toHaveLength(1)
    })
  })

  it('does not cache failures', async () => {
    let status = 500
    const { api } = fetcher(async () => json([1], { status }))
    await expect(api.fetchJson('https://api.example.com/flaky')).rejects.toMatchObject({ message: 'The API answered HTTP 500' })
    status = 200
    expect((await api.fetchJson('https://api.example.com/flaky')).json).toEqual([1])
  })
})
