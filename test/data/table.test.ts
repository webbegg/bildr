import { describe, expect, it } from 'vitest'
import { cellInput, moveCell, moveForKey, nextSort, parseCell, searchRecords, selectRows, sortRecords } from '#shared/data/table'
import type { DataRecord, RecordValue } from '#shared/data/records'
import type { Field } from '#shared/document/schema'

const fields: Field[] = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'price', label: 'Price', type: 'number' },
  { key: 'vegan', label: 'Vegan', type: 'boolean' },
  { key: 'servedFrom', label: 'Served from', type: 'date' },
  { key: 'note', label: 'Note', type: 'text' }
]

function record(id: string, values: Record<string, RecordValue>): DataRecord {
  return { id, createdAt: '2026-11-10T00:00:00.000Z', updatedAt: '2026-11-10T00:00:00.000Z', values }
}

const records = [
  record('a', { name: 'Latte', price: 10, vegan: false, servedFrom: '2026-03-01', note: null }),
  record('b', { name: 'espresso', price: 2, vegan: true, servedFrom: null, note: 'Strong' }),
  record('c', { name: 'Flat white', price: null, vegan: null, servedFrom: '2026-01-15T08:00:00.000Z', note: 'Milky latte' })
]

const ids = (list: DataRecord[]) => list.map(r => r.id).join(',')

describe('searchRecords', () => {
  it('keeps records whose text fields contain the query, ignoring case', () => {
    expect(ids(searchRecords(records, fields, 'LATTE'))).toBe('a,c')
    expect(ids(searchRecords(records, fields, ' strong '))).toBe('b')
    expect(ids(searchRecords(records, fields, 'zzz'))).toBe('')
  })

  it('an empty query keeps every record', () => {
    expect(ids(searchRecords(records, fields, '  '))).toBe('a,b,c')
  })
})

describe('nextSort', () => {
  it('cycles a header asc → desc → none, and another header starts at asc', () => {
    expect(nextSort(null, 'name')).toEqual({ key: 'name', direction: 'asc' })
    expect(nextSort({ key: 'name', direction: 'asc' }, 'name')).toEqual({ key: 'name', direction: 'desc' })
    expect(nextSort({ key: 'name', direction: 'desc' }, 'name')).toBeNull()
    expect(nextSort({ key: 'name', direction: 'desc' }, 'price')).toEqual({ key: 'price', direction: 'asc' })
  })
})

describe('sortRecords', () => {
  it('compares per field type, empty values last in both directions', () => {
    expect(ids(sortRecords(records, fields, { key: 'name', direction: 'asc' }))).toBe('b,c,a')
    expect(ids(sortRecords(records, fields, { key: 'name', direction: 'desc' }))).toBe('a,c,b')
    expect(ids(sortRecords(records, fields, { key: 'price', direction: 'asc' }))).toBe('b,a,c')
    expect(ids(sortRecords(records, fields, { key: 'price', direction: 'desc' }))).toBe('a,b,c')
    expect(ids(sortRecords(records, fields, { key: 'vegan', direction: 'asc' }))).toBe('a,b,c')
    expect(ids(sortRecords(records, fields, { key: 'servedFrom', direction: 'asc' }))).toBe('c,a,b')
    expect(ids(sortRecords(records, fields, { key: 'servedFrom', direction: 'desc' }))).toBe('a,c,b')
  })

  it('compares numbers inside text naturally', () => {
    const items = [record('x', { name: 'Item 10' }), record('y', { name: 'Item 9' })]
    expect(ids(sortRecords(items, fields, { key: 'name', direction: 'asc' }))).toBe('y,x')
  })

  it('no sort keeps the loaded order', () => {
    expect(sortRecords(records, fields, null)).toBe(records)
  })
})

describe('moveCell', () => {
  const size = { rows: 3, cols: 4 }

  it('arrows move one cell and stop at the edges', () => {
    expect(moveCell({ row: 1, col: 1 }, 'up', size)).toEqual({ row: 0, col: 1 })
    expect(moveCell({ row: 1, col: 1 }, 'down', size)).toEqual({ row: 2, col: 1 })
    expect(moveCell({ row: 1, col: 1 }, 'left', size)).toEqual({ row: 1, col: 0 })
    expect(moveCell({ row: 1, col: 1 }, 'right', size)).toEqual({ row: 1, col: 2 })
    expect(moveCell({ row: 0, col: 0 }, 'up', size)).toEqual({ row: 0, col: 0 })
    expect(moveCell({ row: 0, col: 0 }, 'left', size)).toEqual({ row: 0, col: 0 })
    expect(moveCell({ row: 2, col: 3 }, 'down', size)).toEqual({ row: 2, col: 3 })
    expect(moveCell({ row: 2, col: 3 }, 'right', size)).toEqual({ row: 2, col: 3 })
  })

  it('Tab and Shift+Tab wrap across rows and stop at the first and last cell', () => {
    expect(moveCell({ row: 0, col: 3 }, 'next', size)).toEqual({ row: 1, col: 0 })
    expect(moveCell({ row: 1, col: 0 }, 'prev', size)).toEqual({ row: 0, col: 3 })
    expect(moveCell({ row: 2, col: 3 }, 'next', size)).toEqual({ row: 2, col: 3 })
    expect(moveCell({ row: 0, col: 0 }, 'prev', size)).toEqual({ row: 0, col: 0 })
  })

  it('maps keys to moves', () => {
    expect(moveForKey('ArrowUp', false)).toBe('up')
    expect(moveForKey('ArrowRight', false)).toBe('right')
    expect(moveForKey('Tab', false)).toBe('next')
    expect(moveForKey('Tab', true)).toBe('prev')
    expect(moveForKey('a', false)).toBeNull()
  })
})

describe('selectRows', () => {
  const order = ['a', 'b', 'c', 'd', 'e']

  it('a click toggles one row', () => {
    expect(selectRows(order, [], 'b', null, false)).toEqual(['b'])
    expect(selectRows(order, ['b', 'd'], 'b', 'd', false)).toEqual(['d'])
  })

  it('Shift-click gives the range from the anchor the clicked row\'s new state', () => {
    expect(selectRows(order, ['b'], 'd', 'b', true)).toEqual(['b', 'c', 'd'])
    expect(selectRows(order, ['e'], 'b', 'd', true)).toEqual(['b', 'c', 'd', 'e'])
    expect(selectRows(order, ['a', 'b', 'c', 'd'], 'c', 'a', true)).toEqual(['d'])
  })

  it('Shift-click without a shown anchor toggles one row', () => {
    expect(selectRows(order, [], 'c', 'gone', true)).toEqual(['c'])
  })
})

describe('cellInput', () => {
  it('is what a cell editor starts with: the day of a date-time, empty for no value', () => {
    expect(cellInput('date', '2026-01-15T08:00:00.000Z')).toBe('2026-01-15')
    expect(cellInput('number', 3.5)).toBe('3.5')
    expect(cellInput('text', null)).toBe('')
  })
})

describe('parseCell', () => {
  it('parses a cell input into the field type', () => {
    expect(parseCell('text', 'Flat white')).toBe('Flat white')
    expect(parseCell('number', ' 3.5 ')).toBe(3.5)
    expect(parseCell('number', '-2')).toBe(-2)
    expect(parseCell('boolean', 'true')).toBe(true)
    expect(parseCell('boolean', 'No')).toBe(false)
    expect(parseCell('boolean', true)).toBe(true)
    expect(parseCell('date', '2026-11-10')).toBe('2026-11-10')
    expect(parseCell('image', ' https://example.com/a.png ')).toBe('https://example.com/a.png')
  })

  it('omits an empty input', () => {
    for (const type of ['text', 'number', 'boolean', 'date', 'image'] as const) {
      expect(parseCell(type, '')).toBeUndefined()
      expect(parseCell(type, '   ')).toBeUndefined()
    }
  })

  it('keeps an input that does not fit, so the server names the problem', () => {
    expect(parseCell('number', 'abc')).toBe('abc')
    expect(parseCell('boolean', 'maybe')).toBe('maybe')
  })
})
