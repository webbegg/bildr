import { ActionError } from '../actions/define'
import { guardedFetch } from './urlGuard'
import type { Resolver, Transport } from './urlGuard'

/**
 * Fetches an API source's JSON for previews, record reads and published
 * apps: through the SSRF guard, GET only, with a timeout, a size cap
 * enforced while streaming, and a short in-memory cache so a page of Lists
 * (or a busy published app) does not hit the API on every read. The cache
 * is keyed by a hash of the URL and headers, which may hold resolved secrets.
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

  async function load(url: string, customHeaders?: Record<string, string>): Promise<ApiResponse> {
    const signal = AbortSignal.timeout(timeoutMs)
    let body: Uint8Array
    try {
      const response = await guardedFetch(url, { resolve, transport, signal, headers: { 'accept': 'application/json', 'user-agent': 'bildr' }, customHeaders })
      if (!response.ok) {
        await response.body?.cancel()
        fail(`The API answered HTTP ${response.status}`)
      }
      if (!/\bjson\b/i.test(response.headers.get('content-type') ?? '')) {
        await response.body?.cancel()
        fail('The API response is not JSON')
      }
      body = await readBody(response)
    } catch (error) {
      if (error instanceof ActionError) throw error
      if (signal.aborted) fail(`The API did not answer within ${timeoutMs / 1000} s`)
      fail(`Could not reach the API: ${error instanceof Error ? error.message : String(error)}`)
    }
    let json: unknown
    try {
      json = JSON.parse(new TextDecoder().decode(body!))
    } catch {
      fail('The API response is not JSON')
    }
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
    }
  }
}

export type ApiFetcher = ReturnType<typeof createApiFetcher>
