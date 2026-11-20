import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { generate } from '../../src/generate/index'
import { loadModel } from '../../src/model/load'
import { fixtureModelFiles } from '../model/fixture'

/**
 * Simple data S8 / P3: the browser client of the API sources keeps the guards of the server one (the path is the one the model built,
 * under the base URL, no dot segments, no redirect followed, a size cap) and sends no credentials. The generated file is run for real
 * (Node's fetch), against a local server and a second one a redirect would lead to.
 */
interface Request { method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', query?: Record<string, string | number | boolean | undefined>, body?: unknown }
interface Module {
  createBrowserClient: (options: { baseUrl: string, signal?: AbortSignal }) => (path: string, request: Request) => Promise<unknown>
  valueOrThrow: <T>(result: { ok: true, value: T } | { ok: false, error: { message: string } }) => T
}

describe('generated browser client', () => {
  const seen: Array<{ method?: string, url?: string, headers: Record<string, string | string[] | undefined>, body: string }> = []
  const elsewhere: string[] = []
  const other = createServer((request, response) => {
    elsewhere.push(request.url!)
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end('{"leaked":true}')
  })
  let otherUrl = ''
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', chunk => (body += chunk))
    request.on('end', () => {
      seen.push({ method: request.method, url: request.url, headers: request.headers, body })
      const path = new URL(request.url!, 'http://stub').pathname
      if (path === '/v1/redirect') {
        response.writeHead(302, { location: `${otherUrl}/v1/things` })
        return response.end()
      }
      if (path === '/v1/big') {
        response.writeHead(200, { 'content-type': 'application/json' })
        return response.end(JSON.stringify({ filler: 'x'.repeat(1_100_000) }))
      }
      if (path === '/v1/fail') {
        response.writeHead(500)
        return response.end('{"secret_internal":"upstream"}')
      }
      if (path === '/v1/empty') {
        response.writeHead(204)
        return response.end()
      }
      if (path === '/v1/text') {
        response.writeHead(200)
        return response.end('<html>')
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ ok: true }))
    })
  })
  let baseUrl = ''
  let client: Module
  const dir = mkdtempSync(join(tmpdir(), 'bildr-browser-client-'))
  beforeAll(async () => {
    const loaded = loadModel(fixtureModelFiles())
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
    const source = generate(loaded.model).find(file => file.path === 'layers/apis/app/data/browser-client.ts')!.content
    const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
    writeFileSync(join(dir, 'browser-client.mjs'), js)
    client = (await import(pathToFileURL(join(dir, 'browser-client.mjs')).href)) as Module
    await new Promise<void>(resolve => other.listen(0, '127.0.0.1', resolve))
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    otherUrl = `http://127.0.0.1:${(other.address() as AddressInfo).port}`
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  })
  afterAll(async () => {
    rmSync(dir, { recursive: true, force: true })
    await new Promise<void>(resolve => server.close(() => resolve()))
    await new Promise<void>(resolve => other.close(() => resolve()))
  })

  it('calls the path under the base URL with the query (an undefined value is not sent) and sends no credentials', async () => {
    seen.length = 0
    const call = client.createBrowserClient({ baseUrl })
    await expect(call('/things', { method: 'GET', query: { q: 'a b', page: 2, skip: undefined } })).resolves.toEqual({ ok: true })
    expect(seen.map(entry => entry.url)).toEqual(['/v1/things?q=a+b&page=2'])
    expect(seen[0]!.headers.accept).toBe('application/json')
    expect(Object.keys(seen[0]!.headers).filter(name => /^(?:authorization|cookie|proxy-authorization|x-.*)$/.test(name))).toEqual([])
  })

  it('sends a body as JSON', async () => {
    seen.length = 0
    await client.createBrowserClient({ baseUrl })('/reports', { method: 'POST', body: { city: 'Lisbon' } })
    expect(seen[0]).toMatchObject({ method: 'POST', url: '/v1/reports', body: '{"city":"Lisbon"}' })
    expect(seen[0]!.headers['content-type']).toBe('application/json')
  })

  it.each(['..', '.', '%2e%2e', '%2E.', '.%2e', '%2e'])('refuses a path with the dot segment %j, and the server sees no request', async (segment) => {
    seen.length = 0
    await expect(client.createBrowserClient({ baseUrl })(`/things/${segment}/parts`, { method: 'GET' })).rejects.toMatchObject({ name: 'BrowserFailure', status: 0, message: 'was asked for a path with a "." or ".." segment' })
    expect(seen).toEqual([])
  })

  it('refuses a path that is not under the base URL (a second slash would be another host)', async () => {
    seen.length = 0
    elsewhere.length = 0
    const call = client.createBrowserClient({ baseUrl })
    await expect(call(`//${otherUrl.slice('http://'.length)}/things`, { method: 'GET' })).rejects.toMatchObject({ name: 'BrowserFailure', message: 'was asked for a path outside its base URL' })
    await expect(call('/../other', { method: 'GET' })).rejects.toMatchObject({ name: 'BrowserFailure' })
    expect(seen).toEqual([])
    expect(elsewhere).toEqual([])
  })

  it('does not follow a redirect: the other host is never asked', async () => {
    seen.length = 0
    elsewhere.length = 0
    await expect(client.createBrowserClient({ baseUrl })('/redirect', { method: 'GET' })).rejects.toMatchObject({ name: 'BrowserFailure', message: 'answered 302: a redirect is not followed' })
    expect(seen.map(entry => entry.url)).toEqual(['/v1/redirect'])
    expect(elsewhere).toEqual([])
  })

  it('fails with the status, and never carries the body of the answer', async () => {
    const failure = await client.createBrowserClient({ baseUrl })('/fail', { method: 'GET' }).catch((error: Error) => error)
    expect(failure).toMatchObject({ name: 'BrowserFailure', status: 500, message: 'answered 500' })
    expect(JSON.stringify(failure)).not.toContain('upstream')
  })

  it('refuses an answer over 1 MB, answers undefined for an empty one and fails for one without JSON', async () => {
    const call = client.createBrowserClient({ baseUrl })
    await expect(call('/big', { method: 'GET' })).rejects.toMatchObject({ name: 'BrowserFailure', message: 'answered more than 1 MB' })
    await expect(call('/empty', { method: 'GET' })).resolves.toBeUndefined()
    await expect(call('/text', { method: 'GET' })).rejects.toMatchObject({ name: 'BrowserFailure', message: 'answered without JSON' })
  })

  it('does not throw when it is made with a base URL that is not one: the call fails, nothing is sent', async () => {
    seen.length = 0
    for (const bad of ['', 'not a url', undefined as unknown as string]) {
      const call = client.createBrowserClient({ baseUrl: bad })
      await expect(call('/things', { method: 'GET' })).rejects.toMatchObject({ name: 'BrowserFailure', status: 0, message: 'has no valid base URL' })
    }
    expect(seen).toEqual([])
  })

  it('valueOrThrow gives the value of an ok answer and throws the message of an error', () => {
    expect(client.valueOrThrow({ ok: true, value: 3 })).toBe(3)
    expect(() => client.valueOrThrow({ ok: false, error: { message: 'The "weather" API answered 503.' } })).toThrow('The "weather" API answered 503.')
  })

  // Verify R3-001, R3-002, R3-003: the branches a real local server can't reach, run with a fake `fetch`.
  describe('with a fake fetch', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
      vi.restoreAllMocks()
    })

    /** `fetch` answers what `answer` makes of the call; the inits it was called with are kept. */
    const fakeFetch = (answer: (init: RequestInit) => Promise<Response>) => {
      const inits: RequestInit[] = []
      vi.stubGlobal('fetch', (_url: unknown, init: RequestInit) => {
        inits.push(init)
        return answer(init)
      })
      return inits
    }
    /** A call that never answers: it only ends (rejected, as a real fetch is) when its signal aborts. */
    const hangs = (init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init.signal!
      if (signal.aborted) return reject(signal.reason)
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
    const MB = 1_000_000
    /** An answer of `size` bytes in chunks of 100 kB, with the headers given. `cancelled` says whether the reader was cancelled. */
    const streamed = (size: number, headers: Record<string, string> = {}) => {
      const state = { cancelled: false, sent: 0 }
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (state.sent >= size) return controller.close()
          controller.enqueue(new Uint8Array(Math.min(100_000, size - state.sent)).fill(32))
          state.sent += 100_000
        },
        cancel() {
          state.cancelled = true
        }
      })
      return { state, response: new Response(body, { status: 200, headers }) }
    }

    it('refuses an answer over 1 MB that arrives in chunks with no Content-Length, and stops reading it', async () => {
      const { state, response } = streamed(5 * MB)
      expect(response.headers.get('content-length')).toBeNull()
      fakeFetch(async () => response)
      await expect(client.createBrowserClient({ baseUrl })('/chunked', { method: 'GET' })).rejects.toMatchObject({ name: 'BrowserFailure', status: 200, message: 'answered more than 1 MB' })
      expect(state.cancelled).toBe(true)
      expect(state.sent).toBeLessThan(5 * MB)
    })

    it('refuses an answer over 1 MB whose Content-Length says it is small', async () => {
      const { state, response } = streamed(2 * MB, { 'content-length': '10' })
      fakeFetch(async () => response)
      await expect(client.createBrowserClient({ baseUrl })('/lies', { method: 'GET' })).rejects.toMatchObject({ name: 'BrowserFailure', message: 'answered more than 1 MB' })
      expect(state.cancelled).toBe(true)
    })

    it('reads an answer of exactly 1 MB (a JSON string of that size, in chunks)', async () => {
      const text = JSON.stringify('x'.repeat(MB - 2))
      expect(text.length).toBe(MB)
      fakeFetch(async () => new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          const bytes = new TextEncoder().encode(text)
          for (let at = 0; at < bytes.length; at += 100_000) controller.enqueue(bytes.slice(at, at + 100_000))
          controller.close()
        }
      })))
      await expect(client.createBrowserClient({ baseUrl })('/limit', { method: 'GET' })).resolves.toHaveLength(MB - 2)
    })

    it('fails on an opaqueredirect (the browser hides a redirect it did not follow: status 0), reading nothing', async () => {
      const cancelled = vi.fn()
      const opaque = { type: 'opaqueredirect', status: 0, ok: false, headers: new Headers(), body: { cancel: cancelled } } as unknown as Response
      fakeFetch(async () => opaque)
      await expect(client.createBrowserClient({ baseUrl })('/moved', { method: 'GET' })).rejects.toMatchObject({ name: 'BrowserFailure', status: 0, message: 'answered a redirect, which is not followed' })
      expect(cancelled).toHaveBeenCalled()
    })

    it('fails with the generic failure when the fetch rejects (network error, or a refusal by CORS: the browser says no more)', async () => {
      fakeFetch(async () => {
        throw new TypeError('Failed to fetch')
      })
      const failure = await client.createBrowserClient({ baseUrl })('/things', { method: 'GET' }).catch((error: Error) => error)
      expect(failure).toMatchObject({ name: 'BrowserFailure', status: 0, message: 'couldn\'t be reached, or doesn\'t allow calls from this page' })
      expect(JSON.stringify(failure)).not.toContain('Failed to fetch')
    })

    it('fails when the answer does not come within the timeout (the 10 s signal aborts)', async () => {
      const timeout = new AbortController()
      vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal)
      const inits = fakeFetch(hangs)
      const call = client.createBrowserClient({ baseUrl })('/slow', { method: 'GET' })
      timeout.abort()
      await expect(call).rejects.toMatchObject({ name: 'BrowserFailure', status: 0, message: 'didn\'t answer within 10 s' })
      expect(AbortSignal.timeout).toHaveBeenCalledWith(10_000)
      expect(inits[0]!.signal).toBeInstanceOf(AbortSignal)
    })

    it('fails when the body stops arriving within the timeout too', async () => {
      const timeout = new AbortController()
      vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal)
      fakeFetch(async init => new Response(new ReadableStream<Uint8Array>({
        pull: () => new Promise<void>((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true }))
      })))
      const call = client.createBrowserClient({ baseUrl })('/trickle', { method: 'GET' })
      await new Promise(resolve => setTimeout(resolve, 20))
      timeout.abort()
      await expect(call).rejects.toMatchObject({ name: 'BrowserFailure', status: 0, message: 'didn\'t answer within 10 s' })
    })

    // Verify R3-003: TanStack gives each fetch of a query an AbortSignal, and a cancelled query must not keep its request.
    describe('a signal given by the caller (a query that is cancelled)', () => {
      it('aborting it cancels the request that is under way', async () => {
        const cancel = new AbortController()
        const inits = fakeFetch(hangs)
        const call = client.createBrowserClient({ baseUrl, signal: cancel.signal })('/slow', { method: 'GET' })
        expect(inits[0]!.signal!.aborted).toBe(false)
        cancel.abort()
        await expect(call).rejects.toMatchObject({ name: 'BrowserFailure', status: 0, message: 'was cancelled' })
        expect(inits[0]!.signal!.aborted).toBe(true)
      })

      it('aborting it cancels the reading of a body that is arriving', async () => {
        const cancel = new AbortController()
        fakeFetch(async init => new Response(new ReadableStream<Uint8Array>({
          pull: () => new Promise<void>((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true }))
        })))
        const call = client.createBrowserClient({ baseUrl, signal: cancel.signal })('/trickle', { method: 'GET' })
        await new Promise(resolve => setTimeout(resolve, 20))
        cancel.abort()
        await expect(call).rejects.toMatchObject({ name: 'BrowserFailure', message: 'was cancelled' })
      })

      it('a signal that is already aborted sends a request that is cancelled at once', async () => {
        const inits = fakeFetch(hangs)
        await expect(client.createBrowserClient({ baseUrl, signal: AbortSignal.abort() })('/slow', { method: 'GET' })).rejects.toMatchObject({ message: 'was cancelled' })
        expect(inits[0]!.signal!.aborted).toBe(true)
      })

      it('keeps the timeout next to it: the 10 s signal still ends the call', async () => {
        const timeout = new AbortController()
        vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal)
        fakeFetch(hangs)
        const call = client.createBrowserClient({ baseUrl, signal: new AbortController().signal })('/slow', { method: 'GET' })
        timeout.abort()
        await expect(call).rejects.toMatchObject({ status: 0, message: 'didn\'t answer within 10 s' })
      })

      it('a call that is not cancelled answers as it did', async () => {
        const inits = fakeFetch(async () => new Response('{"ok":true}', { status: 200 }))
        await expect(client.createBrowserClient({ baseUrl, signal: new AbortController().signal })('/things', { method: 'GET' })).resolves.toEqual({ ok: true })
        expect(inits[0]!.signal!.aborted).toBe(false)
      })

      it('works in a browser without AbortSignal.any (it joins the signals by hand)', async () => {
        const any = Object.getOwnPropertyDescriptor(AbortSignal, 'any')!
        Object.defineProperty(AbortSignal, 'any', { value: undefined, configurable: true, writable: true })
        try {
          const cancel = new AbortController()
          const inits = fakeFetch(hangs)
          const call = client.createBrowserClient({ baseUrl, signal: cancel.signal })('/slow', { method: 'GET' })
          cancel.abort()
          await expect(call).rejects.toMatchObject({ message: 'was cancelled' })
          expect(inits[0]!.signal!.aborted).toBe(true)
          const timeout = new AbortController()
          vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal)
          fakeFetch(hangs)
          const late = client.createBrowserClient({ baseUrl, signal: new AbortController().signal })('/slow', { method: 'GET' })
          timeout.abort()
          await expect(late).rejects.toMatchObject({ message: 'didn\'t answer within 10 s' })
          vi.restoreAllMocks()
          await expect(client.createBrowserClient({ baseUrl, signal: AbortSignal.abort() })('/slow', { method: 'GET' })).rejects.toMatchObject({ message: 'was cancelled' })
        } finally {
          Object.defineProperty(AbortSignal, 'any', any)
        }
      })
    })
  })
})
