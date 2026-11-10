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
