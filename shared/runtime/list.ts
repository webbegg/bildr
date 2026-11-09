import { coerceValues, queryRecords, readRecord, RECORD_META_FIELDS } from '../data/records'
import type { DataRecord, RecordQuery } from '../data/records'
import type { PropValue } from '../document/components'
import type { Collection, DocNode } from '../document/schema'
import { walk } from '../document/tree'

/**
 * The query a List runs, shared by the editor canvas (which queries the
 * records itself) and published apps (which send it to the public endpoint
 * as URL search params), so both show the same records.
 */

export const LIST_TYPE = 'List'
export const LIST_LIMIT_MAX = 100

/** A List's props, normalized. */
export interface ListQuery {
  collection: string
  limit: number
  sortField: string
  sortDir: 'asc' | 'desc'
  filterField: string
  filterValue: string
}

/** A query in its URL form, before it is checked against a collection's fields. */
export interface ListSearch {
  limit: number
  offset: number
  sortField: string
  sortDir: 'asc' | 'desc'
  /** Field key → value as text; coerced to the field type by `toRecordQuery`. */
  filter: Record<string, string>
}

const clampLimit = (limit: number) => Math.min(LIST_LIMIT_MAX, Math.max(1, Math.floor(limit)))

export function listQueryOf(props: Record<string, PropValue>): ListQuery {
  const text = (name: string) => (typeof props[name] === 'string' ? props[name] : '')
  const limit = typeof props.limit === 'number' && Number.isFinite(props.limit) ? props.limit : 10
  return {
    collection: text('collection'),
    limit: clampLimit(limit),
    sortField: text('sortField').trim(),
    sortDir: props.sortDir === 'desc' ? 'desc' : 'asc',
    filterField: text('filterField').trim(),
    filterValue: text('filterValue')
  }
}

/** Identifies a List's result set: Lists with the same query share it. */
export function listKey(query: ListQuery): string {
  return JSON.stringify([query.collection, query.limit, query.sortField, query.sortDir, query.filterField, query.filterValue])
}

function searchOf(query: ListQuery): ListSearch {
  return {
    limit: query.limit,
    offset: 0,
    sortField: query.sortField,
    sortDir: query.sortDir,
    filter: query.filterField && query.filterValue !== '' ? { [query.filterField]: query.filterValue } : {}
  }
}

/** URL search params for the public endpoint, e.g. `limit=5&sort=price&dir=desc&filter[vegan]=true`. */
export function listSearch(query: ListQuery): string {
  const search = searchOf(query)
  const params = new URLSearchParams({ limit: String(search.limit) })
  if (search.sortField) {
    params.set('sort', search.sortField)
    params.set('dir', search.sortDir)
  }
  for (const [key, value] of Object.entries(search.filter)) params.set(`filter[${key}]`, value)
  return params.toString()
}

const FILTER_PARAM = /^filter\[(.+)\]$/

/** Reads `listSearch` params (as h3's `getQuery` returns them); limit defaults to and is capped at 100. */
export function parseListSearch(params: Record<string, unknown>): { query: ListSearch } | { problem: string } {
  const param = (name: string): string | undefined => {
    const value = params[name]
    const first = Array.isArray(value) ? value[0] : value
    return typeof first === 'string' ? first : undefined
  }
  const whole = (name: string, min: number, fallback: number): number | string => {
    const raw = param(name)
    if (raw === undefined || raw === '') return fallback
    return /^\d+$/.test(raw) && Number(raw) >= min ? Number(raw) : `"${name}" must be a whole number from ${min}`
  }
  const limit = whole('limit', 1, LIST_LIMIT_MAX)
  if (typeof limit === 'string') return { problem: limit }
  const offset = whole('offset', 0, 0)
  if (typeof offset === 'string') return { problem: offset }
  const dir = param('dir') || 'asc'
  if (dir !== 'asc' && dir !== 'desc') return { problem: '"dir" must be asc or desc' }
  const filter: Record<string, string> = {}
  for (const name of Object.keys(params)) {
    const key = FILTER_PARAM.exec(name)?.[1]
    const value = param(name)
    if (key && value !== undefined) filter[key] = value
  }
  return { query: { limit: Math.min(limit, LIST_LIMIT_MAX), offset, sortField: param('sort') ?? '', sortDir: dir, filter } }
}

/** Checks a search against the collection (known sort field, filter values of the field types). */
export function toRecordQuery(collection: Collection, search: ListSearch): { query: RecordQuery } | { problem: string } {
  const { sortField } = search
  if (sortField && !collection.fields.some(f => f.key === sortField) && !(RECORD_META_FIELDS as readonly string[]).includes(sortField)) {
    return { problem: `Cannot sort by "${sortField}": not a field of "${collection.name}"` }
  }
  const filter = coerceValues(collection.fields, search.filter)
  if ('problems' in filter) return { problem: filter.problems.join('; ') }
  return {
    query: {
      filter: filter.values,
      sort: sortField ? { field: sortField, direction: search.sortDir } : undefined,
      limit: search.limit,
      offset: search.offset
    }
  }
}

/** The records a List shows, read with the collection's fields; none when its query does not fit the collection. */
export function listRecords(collection: Collection, records: DataRecord[], query: ListQuery): DataRecord[] {
  const result = toRecordQuery(collection, searchOf(query))
  if ('problem' in result) return []
  return queryRecords(records.map(r => readRecord(collection.fields, r)), result.query).records
}

/** Every List under `root`, nested ones included. */
export function listNodes(root: DocNode): DocNode[] {
  const lists: DocNode[] = []
  walk(root, (node) => {
    if (node.type === LIST_TYPE) lists.push(node)
  })
  return lists
}
