import type { Field, FieldType } from '../document/schema'

/**
 * Collection records: live data kept outside the document, so they are not
 * undoable and not frozen at publish. A record stores raw `values`; readers
 * go through `readRecord`, which projects them onto the current fields.
 */

export type RecordValue = string | number | boolean | null

export interface DataRecord {
  id: string
  createdAt: string
  updatedAt: string
  values: Record<string, RecordValue>
}

export const MAX_RECORDS_PER_COLLECTION = 5000
export const MAX_RECORD_BYTES = 10 * 1024

/** Fields a query can sort on besides the collection's own. */
export const RECORD_META_FIELDS = ['createdAt', 'updatedAt'] as const

export interface RecordQuery {
  /** Field key → value; a record matches when every value is equal. */
  filter?: Record<string, RecordValue>
  sort?: { field: string, direction?: 'asc' | 'desc' }
  limit?: number
  offset?: number
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/

function isDate(value: string): boolean {
  if (ISO_DATE.test(value)) {
    // Rejects dates that roll over, e.g. 2026-02-31.
    return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  }
  return ISO_DATE_TIME.test(value) && !Number.isNaN(Date.parse(value))
}

function isImageUrl(value: string): boolean {
  if (value.startsWith('/') && !value.startsWith('//')) return true
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

const PROBLEMS: Record<FieldType, (key: string) => string> = {
  text: key => `"${key}" must be a string`,
  number: key => `"${key}" must be a number`,
  boolean: key => `"${key}" must be true or false`,
  date: key => `"${key}" must be a date (YYYY-MM-DD or an ISO date-time)`,
  image: key => `"${key}" must be an http(s) URL or a /path`
}

/**
 * Coerces `raw` to a value of `type`, or returns undefined when it does not
 * fit. Form strings are accepted ("3.5", "true"); null clears a value, and so
 * does an empty string for every type but text.
 */
function coerce(type: FieldType, raw: unknown): RecordValue | undefined {
  if (raw === null) return null
  if (raw === '' && type !== 'text') return null
  switch (type) {
    case 'text':
      return typeof raw === 'string' ? raw : undefined
    case 'number': {
      const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw
      return typeof value === 'number' && Number.isFinite(value) ? value : undefined
    }
    case 'boolean':
      if (typeof raw === 'boolean') return raw
      return raw === 'true' ? true : raw === 'false' ? false : undefined
    case 'date':
      return typeof raw === 'string' && isDate(raw) ? raw : undefined
    case 'image':
      return typeof raw === 'string' && raw.length <= 2000 && isImageUrl(raw) ? raw : undefined
  }
}

/** Validates and coerces input values against `fields`; unknown keys are problems. */
export function coerceValues(fields: Field[], values: Record<string, unknown>): { values: Record<string, RecordValue> } | { problems: string[] } {
  const out: Record<string, RecordValue> = {}
  const problems: string[] = []
  for (const [key, raw] of Object.entries(values)) {
    const field = fields.find(f => f.key === key)
    if (!field) {
      problems.push(`Unknown field "${key}"`)
      continue
    }
    const value = coerce(field.type, raw)
    if (value === undefined) problems.push(PROBLEMS[field.type](key))
    else out[key] = value
  }
  return problems.length ? { problems } : { values: out }
}

/**
 * The record as readers see it: one value per current field, unknown keys
 * dropped and stored values that no longer fit the field's type read as null.
 */
export function readRecord(fields: Field[], record: DataRecord): DataRecord {
  const values: Record<string, RecordValue> = {}
  for (const field of fields) values[field.key] = coerce(field.type, record.values[field.key] ?? null) ?? null
  return { ...record, values }
}

/** Size of a stored record in UTF-8 bytes, for the MAX_RECORD_BYTES limit. */
export function recordBytes(record: DataRecord): number {
  return new TextEncoder().encode(JSON.stringify(record)).length
}

function sortValue(record: DataRecord, field: string): RecordValue {
  if (field === 'createdAt' || field === 'updatedAt') return record[field]
  return record.values[field] ?? null
}

function compare(a: RecordValue, b: RecordValue): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
  return String(a).localeCompare(String(b))
}

/**
 * Filters (field equality), sorts (empty values last in either direction),
 * then pages `records`, which should already be read with `readRecord`.
 * Without a sort, records keep their creation order.
 */
export function queryRecords(records: DataRecord[], query: RecordQuery): { total: number, records: DataRecord[] } {
  const filter = Object.entries(query.filter ?? {})
  let matched = records.filter(r => filter.every(([key, value]) => (r.values[key] ?? null) === value))
  if (query.sort) {
    const { field, direction = 'asc' } = query.sort
    const sign = direction === 'desc' ? -1 : 1
    matched = [...matched].sort((x, y) => {
      const a = sortValue(x, field)
      const b = sortValue(y, field)
      if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1
      return sign * compare(a, b)
    })
  }
  const offset = query.offset ?? 0
  return { total: matched.length, records: matched.slice(offset, query.limit === undefined ? undefined : offset + query.limit) }
}
