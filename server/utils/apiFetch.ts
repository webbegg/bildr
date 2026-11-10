import { nextFrom, nextPageUrl, pageRequest, pagesFor, PAGING_MAX_PAGES, PAGING_MAX_RECORDS, totalFrom, withQuery } from '#shared/data/paging'
import type { Paging } from '#shared/data/paging'
import { readItems } from '#shared/data/remote'
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
 * and are never cached. Paged lists (`fetchPages`) cache each page the same
 * way, grouped under their first URL, so invalidating it drops every page.
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
  /** The response's Link header (for paging), when it has one. */
  headers?: { link: string }
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
  headers?: { link: string }
}

export interface FetchPagesOptions extends FetchJsonOptions {
  paging: Paging
  itemsPath?: string
  /** Next-page URLs must stay on this origin (the connection's or the API source's). */
  origin: string
  offset: number
  limit: number
}

export interface PagedItems {
  /** Items `offset` to `offset + limit - 1`, as far as they were read. */
  items: unknown[]
  /** From the paging's `totalPath`, else the number of items known so far. */
  total: number
  hasMore: boolean
  fetchedAt: string
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
    let link: string | null = null
    try {
      const response = await guardedFetch(url, { resolve, transport, signal, headers, customHeaders, method, body: payload === undefined ? undefined : JSON.stringify(payload) })
      status = response.status
      link = response.headers.get('link')
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
    let json: unknown
    try {
      json = JSON.parse(new TextDecoder().decode(body!))
    } catch {
      return fail('The API response is not JSON')
    }
    return link ? { status: status!, json, headers: { link } } : { status: status!, json }
  }

  async function load(url: string, headers?: Record<string, string>): Promise<ApiResponse> {
    const { json, headers: responseHeaders } = await request(url, { headers })
    const response: ApiResponse = { json, fetchedAt: new Date(now()).toISOString() }
    if (responseHeaders) response.headers = responseHeaders
    return response
  }

  /** Cache keys of the pages read after the first one, by the first page's key. */
  const groups = new Map<string, Set<string>>()

  async function fetchJson(url: string, { headers }: FetchJsonOptions = {}, key?: string): Promise<ApiResponse> {
    key ??= await cacheKey(url, headers)
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

  /**
   * Reads the pages that hold items `offset` to `offset + limit - 1`: `page`
   * and `offset` paging jump to them, `cursor` and `next` walk from the first
   * page. At most 20 pages and 1,000 items per call; past either the result
   * is cut and `hasMore` is true. A next URL off `origin` throws.
   */
  async function fetchPages(url: string, { headers, paging, itemsPath, origin, offset, limit }: FetchPagesOptions): Promise<PagedItems> {
    const group = await cacheKey(url, headers)
    const end = offset + limit
    const items: unknown[] = []
    let pages = 0
    let read = 0
    let known = 0
    let total: number | undefined
    let fetchedAt = new Date(now()).toISOString()
    const capped = () => pages >= PAGING_MAX_PAGES || read >= PAGING_MAX_RECORDS
    const page = async (pageUrl: string, start: number) => {
      const key = await cacheKey(pageUrl, headers)
      if (key !== group) {
        const keys = groups.get(group) ?? new Set()
        groups.delete(group)
        groups.set(group, keys.add(key))
        while (groups.size > maxEntries) groups.delete(groups.keys().next().value!)
      }
      const response = await fetchJson(pageUrl, { headers }, key)
      const list = readItems(response.json, itemsPath) ?? fail(`The API response has no list of items at "${itemsPath ?? ''}"`)
      pages += 1
      read += list.length
      if (pages === 1) fetchedAt = response.fetchedAt
      total ??= totalFrom(paging, response.json)
      list.forEach((item, i) => {
        if (start + i >= offset && start + i < end) items.push(item)
      })
      known = Math.max(known, start + list.length)
      return { list, response }
    }
    const result = (hasMore: boolean): PagedItems => ({ items, total: total ?? known, hasMore, fetchedAt })

    if (paging.type === 'page' || paging.type === 'offset') {
      let size: number | undefined = paging.size
      let index = size ? pagesFor(offset, limit, size).first : 0
      for (;;) {
        if (capped()) return result(true)
        const start = index * (size ?? 0)
        const { list } = await page(withQuery(url, pageRequest(paging, index)), start)
        size ??= list.length
        const more = list.length > 0 && (total === undefined ? list.length >= size : start + list.length < total)
        if (!more) return result(false)
        if (start + list.length >= end) return result(true)
        index = Math.max(index + 1, pagesFor(offset, limit, size).first)
      }
    }

    const seen = new Set<string>()
    let pageUrl = url
    let cursor: string | undefined
    for (let index = 0; ; index++) {
      if (capped()) return result(true)
      seen.add(pageUrl)
      const { list, response } = await page(pageUrl, known)
      const next = nextFrom(paging, response.json, response.headers)
      if (!next || !list.length) return result(false)
      if (known >= end) return result(true)
      if (paging.type === 'cursor') cursor = next
      const following = paging.type === 'cursor' ? withQuery(url, pageRequest(paging, index + 1, cursor)) : followNext(next, pageUrl, origin)
      if (seen.has(following)) return result(false)
      pageUrl = following
    }
  }

  function followNext(next: string, pageUrl: string, origin: string): string {
    try {
      return nextPageUrl(next, pageUrl, origin)
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error))
    }
  }

  return {
    /** The parsed JSON at `url`, from the cache when fetched less than 60 s ago. Failures throw `ActionError('invalid')` and are not cached. */
    fetchJson(url: string, options: FetchJsonOptions = {}): Promise<ApiResponse> {
      return fetchJson(url, options)
    },

    fetchPages,

    /**
     * The URL of the page after the first one fetched at `url`, for previews;
     * null when the response says there is none. A next URL off `origin` throws.
     */
    pageTwoUrl(url: string, paging: Paging, first: { json: unknown, headers?: { link: string } }, origin: string): string | null {
      if (paging.type === 'page' || paging.type === 'offset') return withQuery(url, pageRequest(paging, 1))
      const next = nextFrom(paging, first.json, first.headers)
      if (next === null) return null
      return paging.type === 'cursor' ? withQuery(url, pageRequest(paging, 1, next)) : followNext(next, url, origin)
    },

    /** Drops the cached response of `url` with `headers`, and every later page read from it, so the next read fetches again. */
    async invalidate(url: string, { headers }: FetchJsonOptions = {}): Promise<void> {
      const key = await cacheKey(url, headers)
      cache.delete(key)
      for (const page of groups.get(key) ?? []) cache.delete(page)
      groups.delete(key)
    },

    /** One request with any method and an optional JSON body; never cached. Failures throw `ActionError('invalid')`. */
    send(url: string, options: SendOptions): Promise<SendResponse> {
      return request(url, options)
    }
  }
}

export type ApiFetcher = ReturnType<typeof createApiFetcher>
