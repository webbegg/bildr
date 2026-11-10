import { ActionError } from '../actions/define'
import { guardedFetch } from './urlGuard'
import type { Resolver, Transport } from './urlGuard'

/**
 * Fetches an API source's JSON for previews, record reads and published
 * apps: through the SSRF guard, GET only, with a timeout, a size cap
 * enforced while streaming, and a short in-memory cache so a page of Lists
 * (or a busy published app) does not hit the API on every read. The cache
 * is keyed by a hash of the URL and headers, which may hold resolved secrets.
 * Writes of connection collections (`send`) take the same guard and limits
 * and are never cached.
 */

export interface ApiFetcherOptions {
  resolve?: Resolver
  transport?: Transport
  timeoutMs?: number
  maxBytes?: number
  ttlMs?: number
  maxEntries?: number
  now?: () => number
}

export interface ApiResponse {
  json: unknown
  fetchedAt: string
}

export interface FetchJsonOptions {
  /** The source's own headers, already resolved; dropped when a redirect changes origin. */
  headers?: Record<string, string>
}

export interface SendOptions extends FetchJsonOptions {
  method: string
  /** Sent as JSON. */
  body?: unknown
}

export interface SendResponse {
  status: number
  /** null for an empty or non-JSON body. */
  json: unknown
}

async function cacheKey(url: string, headers: Record<string, string> = {}): Promise<string> {
  const text = JSON.stringify([url, Object.entries(headers).sort(([a], [b]) => a.localeCompare(b))])
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

function size(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${bytes / 1024 / 1024} MB` : `${bytes / 1024} KB`
}

export function createApiFetcher(options: ApiFetcherOptions = {}) {
  const { resolve, transport, timeoutMs = 5000, maxBytes = 1024 * 1024, ttlMs = 60_000, maxEntries = 100, now = Date.now } = options
  const cache = new Map<string, { at: number, response: ApiResponse }>()
  const pending = new Map<string, Promise<ApiResponse>>()
  const fail = (message: string): never => {
    throw new ActionError('invalid', message)
  }
  const tooLarge = () => fail(`The API response is larger than ${size(maxBytes)}`)

  async function readBody(response: Response): Promise<Uint8Array> {
    if (Number(response.headers.get('content-length') ?? 0) > maxBytes) {
      await response.body?.cancel()
      tooLarge()
    }
    const reader = response.body?.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    while (reader) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        tooLarge()
      }
      chunks.push(value)
    }
    const body = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      body.set(chunk, offset)
      offset += chunk.byteLength
    }
    return body
  }

  /** Reads must answer JSON; writes may answer nothing or something else, read as null. */
  async function request(url: string, { method = 'GET', headers: customHeaders, body: payload }: Partial<SendOptions> = {}): Promise<SendResponse> {
    const signal = AbortSignal.timeout(timeoutMs)
    const write = method !== 'GET'
    const headers: Record<string, string> = { 'accept': 'application/json', 'user-agent': 'bildr' }
    if (payload !== undefined) headers['content-type'] = 'application/json'
    let status: number
    let body: Uint8Array
    try {
      const response = await guardedFetch(url, { resolve, transport, signal, headers, customHeaders, method, body: payload === undefined ? undefined : JSON.stringify(payload) })
      status = response.status
      if (!response.ok) {
        await response.body?.cancel()
        fail(`The API answered HTTP ${response.status}`)
      }
      if (!/\bjson\b/i.test(response.headers.get('content-type') ?? '')) {
        await response.body?.cancel()
        if (write) return { status, json: null }
        fail('The API response is not JSON')
      }
      body = await readBody(response)
    } catch (error) {
      if (error instanceof ActionError) throw error
      if (signal.aborted) fail(`The API did not answer within ${timeoutMs / 1000} s`)
      fail(`Could not reach the API: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (write && !body!.byteLength) return { status: status!, json: null }
    try {
      return { status: status!, json: JSON.parse(new TextDecoder().decode(body!)) }
    } catch {
      return fail('The API response is not JSON')
    }
  }

  async function load(url: string, headers?: Record<string, string>): Promise<ApiResponse> {
    const { json } = await request(url, { headers })
    return { json, fetchedAt: new Date(now()).toISOString() }
  }

  return {
    /** The parsed JSON at `url`, from the cache when fetched less than 60 s ago. Failures throw `ActionError('invalid')` and are not cached. */
    async fetchJson(url: string, { headers }: FetchJsonOptions = {}): Promise<ApiResponse> {
      const key = await cacheKey(url, headers)
      const hit = cache.get(key)
      if (hit && now() - hit.at < ttlMs) return hit.response
      cache.delete(key)
      // Concurrent reads of one URL (several Lists, many visitors) share a request.
      let request = pending.get(key)
      if (!request) {
        request = load(url, headers).finally(() => pending.delete(key))
        pending.set(key, request)
      }
      const response = await request
      cache.set(key, { at: now(), response })
      while (cache.size > maxEntries) cache.delete(cache.keys().next().value!)
      return response
    },

    /** Drops the cached response of `url` with `headers`, so the next read fetches again. */
    async invalidate(url: string, { headers }: FetchJsonOptions = {}): Promise<void> {
      cache.delete(await cacheKey(url, headers))
    },

    /** One request with any method and an optional JSON body; never cached. Failures throw `ActionError('invalid')`. */
    send(url: string, options: SendOptions): Promise<SendResponse> {
      return request(url, options)
    }
  }
}

export type ApiFetcher = ReturnType<typeof createApiFetcher>
