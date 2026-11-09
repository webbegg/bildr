import { queryRecords, readRecord } from '#shared/data/records'
import type { DataRecord } from '#shared/data/records'
import type { Collection, PublishedSnapshot } from '#shared/document/schema'
import { parseListSearch, toRecordQuery } from '#shared/runtime/list'

/**
 * The public data endpoint's rules, for published apps (which may be
 * embedded anywhere, so the flags are the only protection): a collection is
 * readable only when its PUBLISHED schema says `publicRead`, and readers get
 * the declared fields only, at most 100 records a page.
 */

export function publicCollection(snapshot: PublishedSnapshot | undefined, slug: string): Collection | undefined {
  const collection = snapshot?.project.collections.find(c => c.slug === slug)
  return collection?.publicRead ? collection : undefined
}

/** Queries `stored` with the endpoint's search params (see `listSearch`). */
export function publicRecords(collection: Collection, stored: DataRecord[], params: Record<string, unknown>): { total: number, records: DataRecord[] } | { problem: string } {
  const search = parseListSearch(params)
  if ('problem' in search) return search
  const query = toRecordQuery(collection, search.query)
  if ('problem' in query) return query
  return queryRecords(stored.map(r => readRecord(collection.fields, r)), query.query)
}
