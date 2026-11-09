import { coerceValues, MAX_RECORD_BYTES, MAX_RECORDS_PER_COLLECTION, queryRecords, readRecord, recordBytes } from '#shared/data/records'
import type { DataRecord } from '#shared/data/records'
import { newId } from '#shared/document/factory'
import type { Collection, PublishedSnapshot } from '#shared/document/schema'
import { parseListSearch, toRecordQuery } from '#shared/runtime/list'
import type { RecordStore } from './recordStore'

/**
 * The public data endpoint's rules, for published apps (which may be
 * embedded anywhere, so the flags are the only protection): a collection is
 * readable only when its PUBLISHED schema says `publicRead`, and readers get
 * the declared fields only, at most 100 records a page. A collection takes
 * new records only when its published schema says `publicCreate` and it is
 * internal; there is no public update or delete. Any website can post to a
 * publicCreate collection (there is no same-origin check), which is what the
 * flag opts into. Messages stay generic: they name the visitor's own fields
 * at most, never addresses or upstream errors.
 */

/** Largest accepted request body of a public write. */
export const PUBLIC_BODY_MAX_BYTES = 16 * 1024

export function publicCollection(snapshot: PublishedSnapshot | undefined, slug: string): Collection | undefined {
  const collection = snapshot?.project.collections.find(c => c.slug === slug)
  return collection?.publicRead ? collection : undefined
}

export type PublicWriteResult
  = | { ok: true, record: DataRecord }
    | { ok: false, status: 400 | 403 | 404 | 413 | 422, message: string }

const BODY_HINT = 'Send JSON { "values": { "<field>": <value> } }'

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

export interface PublicRecordInput {
  snapshot: PublishedSnapshot
  collectionSlug: string
  /** The parsed request body, expected to be `{ values }`. */
  body: unknown
  store: RecordStore
  now?: Date
}

/**
 * Adds a record from a published app's form. Unknown keys are dropped, the
 * rest are checked against the field types; fields are never required. The
 * caller holds the project lock around this read-modify-write.
 */
export async function createPublicRecord({ snapshot, collectionSlug, body, store, now = new Date() }: PublicRecordInput): Promise<PublicWriteResult> {
  const collection = snapshot.project.collections.find(c => c.slug === collectionSlug)
  if (!collection?.publicCreate) return { ok: false, status: 404, message: 'Collection not found' }
  if (collection.source.type !== 'internal') return { ok: false, status: 403, message: 'This collection does not accept new records' }
  if (!isObject(body) || !isObject(body.values)) return { ok: false, status: 400, message: BODY_HINT }

  const declared = Object.entries(body.values).filter(([key]) => collection.fields.some(f => f.key === key))
  const checked = coerceValues(collection.fields, Object.fromEntries(declared))
  if ('problems' in checked) return { ok: false, status: 422, message: checked.problems.join('; ') }

  const records = await store.list(snapshot.project.id, collection.id)
  if (records.length >= MAX_RECORDS_PER_COLLECTION) return { ok: false, status: 403, message: 'This collection is full' }
  const time = now.toISOString()
  const record: DataRecord = { id: newId('rec'), createdAt: time, updatedAt: time, values: checked.values }
  if (recordBytes(record) > MAX_RECORD_BYTES) return { ok: false, status: 413, message: `A record can be at most ${MAX_RECORD_BYTES / 1024} KB` }
  await store.save(snapshot.project.id, collection.id, [...records, record])
  return { ok: true, record }
}

/** Queries `stored` with the endpoint's search params (see `listSearch`). */
export function publicRecords(collection: Collection, stored: DataRecord[], params: Record<string, unknown>): { total: number, records: DataRecord[] } | { problem: string } {
  const search = parseListSearch(params)
  if ('problem' in search) return search
  const query = toRecordQuery(collection, search.query)
  if ('problem' in query) return query
  return queryRecords(stored.map(r => readRecord(collection.fields, r)), query.query)
}
