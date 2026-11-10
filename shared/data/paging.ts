import type { CollectionSource, Field, Paging } from '../document/schema'
import { itemsAt, mapItems, readPath } from './apiSource'
import type { ApiRow } from './apiSource'
import { queryRecords } from './records'
import type { DataRecord, RecordQuery } from './records'

/**
 * Remote list paging: how a List endpoint (or a legacy API source) splits
 * its items over requests. `page` and `offset` number the pages, so any page
 * can be fetched directly; `cursor` and `next` only say where the next page
 * is, so pages are walked in order. These helpers are pure; the server
 * fetches (`server/utils/apiFetch`), within the caps below.
 */

export type { Paging }

export const PAGING_TYPES = ['page', 'offset', 'cursor', 'next'] as const
export type PagingType = typeof PAGING_TYPES[number]

/** At most this many pages and records are read per call; past them the result is cut with `hasMore`. */
export const PAGING_MAX_PAGES = 20
export const PAGING_MAX_RECORDS = 1000
export const PAGE_SIZE_MAX = 500

/** A query parameter name, e.g. `page`, `per_page` or `page[number]`. */
export const PAGING_PARAM = /^[A-Za-z0-9_.~-]+(?:\[[A-Za-z0-9_.~-]*\])*$/
export const PAGING_PARAM_HINT = 'Use a query parameter name such as page or per_page'

export const NEXT_OFF_SITE = 'The API\'s next page is on another site'

/** Records of a paged read: `total` from `totalPath`, else the number of items known so far. */
export interface PagedRecords {
  records: DataRecord[]
  total: number
  hasMore: boolean
}

/** What a test of a paged list says about page two: a mapped sample of up to 10 items and the item count, or why it could not be read. */
export type PageTwo = { count: number, sample: ApiRow[] } | { error: string }

export function pageSample(json: unknown, itemsPath: string, fields: Field[]): PageTwo {
  const items = itemsAt(json, itemsPath)
  if (!items) return { error: `The API response has no list of items at "${itemsPath}"` }
  return { count: items.length, sample: mapItems(items.slice(0, 10), fields) }
}

/** The paging of an API source or of a connection's List endpoint, if it has one. */
export function sourcePaging(source: CollectionSource): Paging | undefined {
  if (source.type === 'api') return source.paging
  return source.type === 'connection' ? source.endpoints.list?.paging : undefined
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isWhole = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0

/** The query parameters of page `pageIndex` (0 is the first); `cursor` is the one the previous page gave. */
export function pageRequest(paging: Paging, pageIndex: number, cursor?: string): Record<string, string> {
  switch (paging.type) {
    case 'page': {
      const params: Record<string, string> = { [paging.param]: String(paging.start + pageIndex) }
      if (paging.sizeParam && paging.size) params[paging.sizeParam] = String(paging.size)
      return params
    }
    case 'offset':
      return { [paging.param]: String(pageIndex * paging.size), [paging.sizeParam]: String(paging.size) }
    case 'cursor':
      return pageIndex > 0 && cursor !== undefined ? { [paging.param]: cursor } : {}
    default:
      return {}
  }
}

/** `url` with `params` set in its query; values are encoded, so they cannot change the path. */
export function withQuery(url: string, params: Record<string, string>): string {
  if (!Object.keys(params).length) return url
  const parsed = new URL(url)
  for (const [name, value] of Object.entries(params)) parsed.searchParams.set(name, value)
  return parsed.href
}

/** The `rel="next"` target of an RFC 5988 Link header, or null. */
export function linkNext(header: string | undefined): string | null {
  for (const match of (header ?? '').matchAll(/<([^>]*)>([^,]*)/g)) {
    const rel = /;\s*rel\s*=\s*"?([^";]+)"?/i.exec(match[2]!)?.[1]
    if (rel?.toLowerCase().split(/\s+/).includes('next') && match[1]) return match[1]
  }
  return null
}

/**
 * The next cursor (`cursor`) or next-page URL (`next`; the Link header when
 * there is no `nextPath`) a response gives, or null at the end. Always null
 * for `page` and `offset`.
 */
export function nextFrom(paging: Paging, body: unknown, headers: Record<string, string | undefined> = {}): string | null {
  if (paging.type === 'cursor') {
    const value = readPath(body, paging.cursorPath)
    return (typeof value === 'string' && value !== '') || typeof value === 'number' ? String(value) : null
  }
  if (paging.type !== 'next') return null
  if (!paging.nextPath) return linkNext(headers.link)
  const value = readPath(body, paging.nextPath)
  return typeof value === 'string' && value !== '' ? value : null
}

/** The total item count at `totalPath`, when it is a whole number. */
export function totalFrom(paging: Paging, body: unknown): number | undefined {
  if (!paging.totalPath) return undefined
  const value = readPath(body, paging.totalPath)
  const total = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  return isWhole(total) ? total : undefined
}

/** The page indexes (0 is the first) that hold items `offset` to `offset + limit - 1`. */
export function pagesFor(offset: number, limit: number, size: number): { first: number, last: number } {
  return { first: Math.floor(offset / size), last: Math.floor((offset + Math.max(limit, 1) - 1) / size) }
}

/**
 * A next-page URL resolved against the URL of the page that gave it, when it
 * stays on `origin`; throws `NEXT_OFF_SITE` otherwise. The message never
 * names the URL.
 */
export function nextPageUrl(value: string, pageUrl: string, origin: string): string {
  let url: URL
  try {
    url = new URL(value, pageUrl)
  } catch {
    throw new Error(NEXT_OFF_SITE)
  }
  if (url.origin !== origin) throw new Error(NEXT_OFF_SITE)
  url.hash = ''
  return url.href
}

const NEXT_PATHS = ['info.next', 'links.next', 'next']
const CURSOR_PATHS = ['meta.next_cursor', 'next_cursor', 'meta.nextCursor', 'nextCursor']
const TOTAL_PATHS = ['info.count', 'info.total', 'meta.total', 'total', 'count', 'total_count']
const PAGE_PATHS = ['page', 'current_page', 'meta.page', 'meta.current_page']
const SIZE_PATHS = ['per_page', 'meta.per_page']

const clampSize = (size: number) => Math.min(Math.max(size, 1), PAGE_SIZE_MAX)

/**
 * Proposes a paging config from common response shapes: a next URL
 * (`info.next`, `links.next`, `next`), a cursor (`meta.next_cursor`,
 * `next_cursor`), an RFC 5988 Link header, `skip`/`offset` with `limit`
 * (also in the request URL), page numbers with `per_page`, or a lone total.
 * Null when the response shows no paging. The user confirms the proposal.
 */
export function detectPaging(body: unknown, headers: Record<string, string | undefined> = {}, url?: string): Paging | null {
  const totalPath = TOTAL_PATHS.find(path => isWhole(readPath(body, path)))
  const withTotal = <T extends Paging>(paging: T): T => (totalPath ? { ...paging, totalPath } : paging)
  if (isObject(body)) {
    const nextPath = NEXT_PATHS.find((path) => {
      const value = readPath(body, path)
      return typeof value === 'string' || (value === null && isObject(readPath(body, path.split('.').slice(0, -1).join('.'))))
    })
    if (nextPath) return withTotal({ type: 'next', nextPath })
    const cursorPath = CURSOR_PATHS.find(path => ['string', 'number'].includes(typeof readPath(body, path)))
    if (cursorPath) return withTotal({ type: 'cursor', param: 'cursor', cursorPath })
  }
  if (linkNext(headers.link)) return withTotal({ type: 'next' })
  const query = url && URL.canParse(url) ? new URL(url).searchParams : undefined
  const number = (name: string) => [readPath(body, name), readPath(body, `meta.${name}`), query?.get(name) ? Number(query.get(name)) : undefined].find(isWhole)
  const limit = number('limit')
  const offsetParam = ['skip', 'offset'].find(name => number(name) !== undefined)
  if (offsetParam && limit) return withTotal({ type: 'offset', param: offsetParam, sizeParam: 'limit', size: clampSize(limit) })
  const current = PAGE_PATHS.map(path => readPath(body, path)).find(isWhole)
  const size = SIZE_PATHS.map(path => readPath(body, path)).find(isWhole)
  if (current !== undefined && size) return withTotal({ type: 'page', param: 'page', start: current === 0 ? 0 : 1, sizeParam: 'per_page', size: clampSize(size) })
  if (totalPath) return { type: 'page', param: 'page', start: 1, totalPath }
  return null
}

/**
 * Runs a record query over a paged list. Without a filter or sort only the
 * window is loaded (`load(offset, limit)`); with one, the pages from the
 * start up to the caps are loaded and queried, so `total` counts the
 * matches among them.
 */
export async function queryPaged(load: (offset: number, limit: number) => Promise<PagedRecords>, query: RecordQuery): Promise<PagedRecords> {
  const { offset = 0, limit = PAGING_MAX_RECORDS } = query
  if (!query.sort && !Object.keys(query.filter ?? {}).length) return load(offset, limit)
  const all = await load(0, PAGING_MAX_RECORDS)
  return { ...queryRecords(all.records, query), hasMore: all.hasMore }
}
