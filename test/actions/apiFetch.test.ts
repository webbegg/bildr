import { describe, expect, it } from 'vitest'
import { createApiFetcher } from '../../server/utils/apiFetch'
import type { Resolver, Transport } from '../../server/utils/urlGuard'

const resolve: Resolver = async host => (host === 'internal.example.com' ? [{ address: '10.0.0.1', family: 4 }] : [{ address: '93.184.216.34', family: 4 }])
const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { ...init, headers: { 'content-type': 'application/json; charset=utf-8', ...init.headers } })

function fetcher(respond: Transport, options: { now?: () => number, timeoutMs?: number, maxBytes?: number, maxEntries?: number } = {}) {
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

  it('does not cache failures', async () => {
    let status = 500
    const { api } = fetcher(async () => json([1], { status }))
    await expect(api.fetchJson('https://api.example.com/flaky')).rejects.toMatchObject({ message: 'The API answered HTTP 500' })
    status = 200
    expect((await api.fetchJson('https://api.example.com/flaky')).json).toEqual([1])
  })
})
