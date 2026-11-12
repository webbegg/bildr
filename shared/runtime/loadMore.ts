import type { DataRecord } from '../data/records'
import type { Collection } from '../document/schema'
import { listPage, listSearch } from './list'
import type { ListQuery } from './list'

/**
 * Load more in published Lists and the preview (a List with `loadMore`):
 * the records loaded so far grow a page (the List's `limit`) at a time,
 * keeping the List's key. Pages are read with the same sort and filter,
 * starting after the records loaded; the server keeps its own caps (at most
 * 100 a page, the paging caps for remote collections). Loading stops when a
 * page brings nothing new, so an API that repeats or cuts pages ends it too.
 */

/** The records a Load more List shows, and whether more follow. */
export interface LoadedList {
  records: DataRecord[]
  more: boolean
}

/** One page as the public endpoint or `record_list` answers it; `hasMore` comes for paged collections. */
export interface ListPage {
  records: DataRecord[]
  total: number
  hasMore?: boolean
}

/** URL search params of the page after `loaded`, for the public endpoint. */
export function nextPageSearch(query: ListQuery, loaded: LoadedList): string {
  return listSearch(query, loaded.records.length)
}

/**
 * Appends a page to the records loaded (none for the first page), dropping
 * records already there by id. More follow while the page brought new ones
 * and the server says so (`hasMore`), or fewer than its total are loaded.
 */
export function mergePage(loaded: LoadedList | undefined, page: ListPage): LoadedList {
  const before = loaded?.records ?? []
  const seen = new Set(before.map(r => r.id))
  const added = page.records.filter((r) => {
    if (seen.has(r.id)) return false
    seen.add(r.id)
    return true
  })
  const records = added.length ? [...before, ...added] : before
  return { records, more: added.length > 0 && (page.hasMore ?? records.length < page.total) }
}

/**
 * The first `count` records of a List's query over records the reader has
 * already (the preview), read with the collection's fields, and whether more
 * of them match. Nothing when the query does not fit the collection.
 */
export function listSlice(collection: Collection, records: DataRecord[], query: ListQuery, count: number): LoadedList {
  const page = listPage(collection, records, query, count)
  return { records: page.records, more: page.records.length < page.total }
}
