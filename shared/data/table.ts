import type { Field, FieldType } from '../document/schema'
import type { DataRecord, RecordValue } from './records'

/**
 * The Data view's records table: search, sort, keyboard moves, selection and
 * cell parsing, as pure functions over the loaded records.
 */

export interface TableSort {
  key: string
  direction: 'asc' | 'desc'
}

/** Records whose text fields contain `query`, ignoring case; an empty query keeps them all. */
export function searchRecords(records: DataRecord[], fields: Field[], query: string): DataRecord[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return records
  const keys = fields.filter(f => f.type === 'text').map(f => f.key)
  return records.filter(r => keys.some(key => typeof r.values[key] === 'string' && (r.values[key] as string).toLowerCase().includes(needle)))
}

export type FilterOp = 'contains' | 'eq' | 'gt' | 'lt' | 'on' | 'off' | 'before' | 'after'

export interface TableFilter {
  key: string
  op: FilterOp
  value?: string
}

const OPS: Record<FieldType, FilterOp[]> = {
  text: ['contains'],
  number: ['eq', 'gt', 'lt'],
  boolean: ['on', 'off'],
  date: ['before', 'after'],
  image: []
}

/** The filters the toolbar offers for a field type. */
export function filterOps(type: FieldType): FilterOp[] {
  return OPS[type]
}

const OP_LABELS: Record<FilterOp, string> = { contains: 'contains', eq: '=', gt: '>', lt: '<', on: 'is on', off: 'is off', before: 'before', after: 'after' }

export function filterLabel(filter: TableFilter, fields: Field[]): string {
  const label = fields.find(f => f.key === filter.key)?.label ?? filter.key
  if (filter.op === 'on' || filter.op === 'off') return `${label} ${OP_LABELS[filter.op]}`
  const value = filter.op === 'contains' ? `“${filter.value ?? ''}”` : filter.value ?? ''
  return `${label} ${OP_LABELS[filter.op]} ${value}`
}

/** A record test for one filter, or null when the filter has no usable value. */
function predicate(filter: TableFilter, type: FieldType): ((value: RecordValue | undefined) => boolean) | null {
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
        const day = cellInput(type, value)
        return filter.op === 'before' ? day < raw : day > raw
      }
    }
  }
}

/** Records matching every filter; filters without a value or a field are ignored. */
export function filterRecords(records: DataRecord[], fields: Field[], filters: TableFilter[]): DataRecord[] {
  const tests = filters.flatMap((filter) => {
    const field = fields.find(f => f.key === filter.key)
    const test = field && predicate(filter, field.type)
    return test ? [{ key: filter.key, test }] : []
  })
  if (!tests.length) return records
  return records.filter(r => tests.every(({ key, test }) => test(r.values[key])))
}

/** The table's shown rows: filtered, searched, then sorted. */
export function tableRows(records: DataRecord[], fields: Field[], view: { query: string, filters: TableFilter[], sort: TableSort | null }): DataRecord[] {
  return sortRecords(searchRecords(filterRecords(records, fields, view.filters), fields, view.query), fields, view.sort)
}

/** A header click, like Framer's: ascending, then descending, then unsorted. */
export function nextSort(sort: TableSort | null, key: string): TableSort | null {
  if (sort?.key !== key) return { key, direction: 'asc' }
  return sort.direction === 'asc' ? { key, direction: 'desc' } : null
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function compare(type: FieldType, a: RecordValue, b: RecordValue): number {
  if (type === 'number' || type === 'boolean') return Number(a) - Number(b)
  if (type === 'date') return Date.parse(String(a)) - Date.parse(String(b))
  return collator.compare(String(a), String(b))
}

/** Records sorted by a field's type; empty values go last either way. No sort keeps the order. */
export function sortRecords(records: DataRecord[], fields: Field[], sort: TableSort | null): DataRecord[] {
  const field = sort && fields.find(f => f.key === sort.key)
  if (!sort || !field) return records
  const sign = sort.direction === 'asc' ? 1 : -1
  const empty = (value: RecordValue | undefined) => value === null || value === undefined || value === ''
  return [...records].sort((x, y) => {
    const a = x.values[field.key]
    const b = y.values[field.key]
    if (empty(a) || empty(b)) return Number(empty(a)) - Number(empty(b))
    return sign * compare(field.type, a!, b!)
  })
}

export interface TableCell {
  row: number
  col: number
}

export type CellMove = 'up' | 'down' | 'left' | 'right' | 'next' | 'prev'

const ARROWS: Record<string, CellMove> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }

export function moveForKey(key: string, shift: boolean): CellMove | null {
  if (key === 'Tab') return shift ? 'prev' : 'next'
  return ARROWS[key] ?? null
}

/** The active cell after a move: arrows stop at the edges, Tab and Shift+Tab wrap across rows. */
export function moveCell(cell: TableCell, move: CellMove, size: { rows: number, cols: number }): TableCell {
  const clamp = (value: number, count: number) => Math.min(Math.max(value, 0), count - 1)
  if (move === 'next' || move === 'prev') {
    const index = clamp(cell.row * size.cols + cell.col + (move === 'next' ? 1 : -1), size.rows * size.cols)
    return { row: Math.floor(index / size.cols), col: index % size.cols }
  }
  const row = cell.row + (move === 'up' ? -1 : move === 'down' ? 1 : 0)
  const col = cell.col + (move === 'left' ? -1 : move === 'right' ? 1 : 0)
  return { row: clamp(row, size.rows), col: clamp(col, size.cols) }
}

/**
 * The selected row ids after a checkbox click on `id`. With Shift and an
 * anchor still shown, every row from the anchor to `id` takes the clicked
 * row's new state. The result follows `order`.
 */
export function selectRows(order: string[], selected: string[], id: string, anchor: string | null, shift: boolean): string[] {
  const next = new Set(selected)
  const on = !next.has(id)
  const from = anchor === null ? -1 : order.indexOf(anchor)
  const to = order.indexOf(id)
  const range = shift && from !== -1 ? order.slice(Math.min(from, to), Math.max(from, to) + 1) : [id]
  for (const each of range) {
    if (on) next.add(each)
    else next.delete(each)
  }
  return order.filter(each => next.has(each))
}

/** What a cell's editor starts with: a date input shows the day of an ISO date-time. */
export function cellInput(type: FieldType, value: RecordValue): string {
  if (value === null) return ''
  return type === 'date' ? String(value).slice(0, 10) : String(value)
}

const TRUE = ['true', 'yes', 'on', '1']
const FALSE = ['false', 'no', 'off', '0']

/**
 * Parses what a cell's input holds into a value of `type`; undefined when it
 * is empty. Input that does not fit stays a string, so the server's check
 * names the problem.
 */
export function parseCell(type: FieldType, raw: string | boolean): RecordValue | undefined {
  if (typeof raw === 'boolean') return raw
  const value = raw.trim()
  if (value === '') return undefined
  switch (type) {
    case 'text':
      return raw
    case 'number': {
      const number = Number(value)
      return Number.isFinite(number) ? number : value
    }
    case 'boolean': {
      const lower = value.toLowerCase()
      return TRUE.includes(lower) ? true : FALSE.includes(lower) ? false : value
    }
    default:
      return value
  }
}
