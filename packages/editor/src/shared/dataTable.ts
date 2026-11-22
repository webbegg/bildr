import type { Row } from '@bildr/codegen/query'
import { valueKindOf } from './dataModel.ts'
import type { DataField, FieldType } from './dataModel.ts'

/**
 * The Data view's table: search, filters, sort and the count, as pure functions over the
 * loaded rows. Ported from the hosted `shared/data/table.ts` over the model's rows (a flat
 * object per row, keyed by field name) and field types. The table is read-only here (records
 * are app data, E2), so the hosted cell moves, row selection, cell parsing and paging
 * drafts are not ported.
 */

export interface TableSort {
  key: string
  direction: 'asc' | 'desc'
}

type Value = unknown

/** A row's id: its `id` value, or its position when it has none (fixtures rows may omit it). */
export const rowId = (row: Row, index: number): string => {
  const id = row.id
  return typeof id === 'string' || typeof id === 'number' ? String(id) : String(index)
}

const isText = (type: FieldType) => type === 'text' || type === 'uuid'

/** Rows whose text fields contain `query`, ignoring case; an empty query keeps them all. */
export function searchRows(rows: Row[], fields: DataField[], query: string): Row[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return rows
  const keys = fields.filter(field => isText(field.type)).map(field => field.name)
  return rows.filter(row => keys.some(key => typeof row[key] === 'string' && (row[key] as string).toLowerCase().includes(needle)))
}

export type FilterOp = 'contains' | 'eq' | 'gt' | 'lt' | 'on' | 'off' | 'before' | 'after'

export interface TableFilter {
  key: string
  op: FilterOp
  value?: string
}

const OPS: Record<FieldType, FilterOp[]> = {
  text: ['contains'],
  uuid: ['contains'],
  integer: ['eq', 'gt', 'lt'],
  number: ['eq', 'gt', 'lt'],
  boolean: ['on', 'off'],
  date: ['before', 'after'],
  datetime: ['before', 'after'],
  image: [],
  email: ['contains'],
  url: ['contains'],
  phone: ['contains'],
  color: ['contains'],
  select: ['contains'],
  money: ['eq', 'gt', 'lt'],
  percent: ['eq', 'gt', 'lt']
}

/** The filters the toolbar offers for a field type. */
export function filterOps(type: FieldType): FilterOp[] {
  return OPS[type]
}

const OP_LABELS: Record<FilterOp, string> = { contains: 'contains', eq: '=', gt: '>', lt: '<', on: 'is on', off: 'is off', before: 'before', after: 'after' }

export function filterLabel(filter: TableFilter, fields: DataField[]): string {
  const label = fields.find(field => field.name === filter.key)?.label ?? filter.key
  if (filter.op === 'on' || filter.op === 'off') return `${label} ${OP_LABELS[filter.op]}`
  const value = filter.op === 'contains' ? `“${filter.value ?? ''}”` : filter.value ?? ''
  return `${label} ${OP_LABELS[filter.op]} ${value}`
}

/** The day (`2026-01-15`) of a date or an ISO date-time. */
const dayOf = (value: Value): string => String(value).slice(0, 10)

/** A row test for one filter, or null when the filter has no usable value. */
function predicate(filter: TableFilter): ((value: Value) => boolean) | null {
  const raw = (filter.value ?? '').trim()
  switch (filter.op) {
    case 'on':
      return value => value === true
    case 'off':
      return value => value !== true
    case 'contains':
      return raw ? value => typeof value === 'string' && value.toLowerCase().includes(raw.toLowerCase()) : null
    case 'eq':
    case 'gt':
    case 'lt': {
      const target = Number(raw)
      if (!raw || !Number.isFinite(target)) return null
      return (value) => {
        if (typeof value !== 'number') return false
        return filter.op === 'eq' ? value === target : filter.op === 'gt' ? value > target : value < target
      }
    }
    case 'before':
    case 'after': {
      if (!raw) return null
      return (value) => {
        if (value === null || value === undefined || value === '') return false
        return filter.op === 'before' ? dayOf(value) < raw : dayOf(value) > raw
      }
    }
  }
}

/** Rows matching every filter; filters without a value or a field are ignored. */
export function filterRows(rows: Row[], fields: DataField[], filters: TableFilter[]): Row[] {
  const tests = filters.flatMap((filter) => {
    const field = fields.find(entry => entry.name === filter.key)
    const test = field && predicate(filter)
    return test ? [{ key: filter.key, test }] : []
  })
  if (!tests.length) return rows
  return rows.filter(row => tests.every(({ key, test }) => test(row[key])))
}

/** The table's shown rows: filtered, searched, then sorted. */
export function tableRows(rows: Row[], fields: DataField[], view: { query: string, filters: TableFilter[], sort: TableSort | null }): Row[] {
  return sortRows(searchRows(filterRows(rows, fields, view.filters), fields, view.query), fields, view.sort)
}

/** A header click, like Framer's: ascending, then descending, then unsorted. */
export function nextSort(sort: TableSort | null, key: string): TableSort | null {
  if (sort?.key !== key) return { key, direction: 'asc' }
  return sort.direction === 'asc' ? { key, direction: 'desc' } : null
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function compare(fieldType: FieldType, a: Value, b: Value): number {
  const type = valueKindOf(fieldType)
  if (type === 'number' || type === 'integer' || type === 'boolean') return Number(a) - Number(b)
  if (type === 'date' || type === 'datetime') return Date.parse(String(a)) - Date.parse(String(b))
  return collator.compare(String(a), String(b))
}

/** Rows sorted by a field's type; empty values go last either way. No sort keeps the order. */
export function sortRows(rows: Row[], fields: DataField[], sort: TableSort | null): Row[] {
  const field = sort && fields.find(entry => entry.name === sort.key)
  if (!sort || !field) return rows
  const sign = sort.direction === 'asc' ? 1 : -1
  const empty = (value: Value) => value === null || value === undefined || value === ''
  return [...rows].sort((x, y) => {
    const a = x[field.name]
    const b = y[field.name]
    if (empty(a) || empty(b)) return Number(empty(a)) - Number(empty(b))
    return sign * compare(field.type, a, b)
  })
}

const items = (n: number) => `${n} ${n === 1 ? 'item' : 'items'}`

/** The toolbar count: "40 items", or the matches among them: "3 of 40 items". */
export function recordsCount({ shown, total, narrowed }: { shown: number, total: number, narrowed: boolean }): string {
  return narrowed ? `${shown} of ${items(total)}` : items(total)
}

const DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

/** What a cell shows for a value: nothing for none, a day as `Mar 1, 2026`, anything else as text. */
export function cellText(type: FieldType, value: Value): string {
  if (value === null || value === undefined || value === '') return ''
  if (type === 'date' || type === 'datetime') {
    const text = String(value)
    const time = Date.parse(text.length === 10 ? `${text}T00:00:00Z` : text)
    return Number.isNaN(time) ? text : DATE.format(time)
  }
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

/** Why the table is not showing the app's rows, in a sentence ("…list route for quotes could not be reached."). */
export function rowsFailure(plural: string, reason: string): string {
  const what = reason.startsWith('has no list route')
    ? 'is not exposed: turn on App list in the panel'
    : reason === 'not a page of rows'
      ? 'did not answer with a page of rows'
      : /^HTTP \d+/.test(reason) ? `answered ${reason}` : reason
  return `The app's list route for ${plural} ${what}.`
}
