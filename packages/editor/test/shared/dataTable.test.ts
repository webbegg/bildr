import { describe, expect, it } from 'vitest'
import type { Row } from '@bildr/codegen/query'
import type { DataField, FieldType } from '../../src/shared/dataModel.ts'
import { cellText, filterLabel, filterOps, filterRows, nextSort, recordsCount, rowId, rowsFailure, searchRows, sortRows, tableRows } from '../../src/shared/dataTable.ts'

/** Ported from the hosted `test/data/table.test.ts` (search, filters, sort and the count), over the model's rows and field types. */

const field = (name: string, label: string, type: FieldType): DataField => ({ id: `fld_${name}`, name, label, type, required: false })

const fields: DataField[] = [
  field('name', 'Name', 'text'),
  field('price', 'Price', 'number'),
  field('vegan', 'Vegan', 'boolean'),
  field('servedFrom', 'Served from', 'date'),
  field('note', 'Note', 'text')
]

const rows: Row[] = [
  { id: 'a', name: 'Latte', price: 10, vegan: false, servedFrom: '2026-03-01', note: null },
  { id: 'b', name: 'espresso', price: 2, vegan: true, servedFrom: null, note: 'Strong' },
  { id: 'c', name: 'Flat white', price: null, vegan: null, servedFrom: '2026-01-15T08:00:00.000Z', note: 'Milky latte' }
]

const ids = (list: Row[]) => list.map(row => row.id).join(',')

describe('searchRows', () => {
  it('keeps rows whose text fields contain the query, ignoring case', () => {
    expect(ids(searchRows(rows, fields, 'LATTE'))).toBe('a,c')
    expect(ids(searchRows(rows, fields, ' strong '))).toBe('b')
    expect(ids(searchRows(rows, fields, 'zzz'))).toBe('')
  })

  it('an empty query keeps every row', () => {
    expect(ids(searchRows(rows, fields, '  '))).toBe('a,b,c')
  })
})

describe('filterOps', () => {
  it('offers the filters that fit each field type', () => {
    expect(filterOps('text')).toEqual(['contains'])
    expect(filterOps('uuid')).toEqual(['contains'])
    expect(filterOps('number')).toEqual(['eq', 'gt', 'lt'])
    expect(filterOps('integer')).toEqual(['eq', 'gt', 'lt'])
    expect(filterOps('boolean')).toEqual(['on', 'off'])
    expect(filterOps('date')).toEqual(['before', 'after'])
    expect(filterOps('datetime')).toEqual(['before', 'after'])
    expect(filterOps('image')).toEqual([])
  })
})

describe('filterRows', () => {
  it('text contains ignores case', () => {
    expect(ids(filterRows(rows, fields, [{ key: 'note', op: 'contains', value: 'MILK' }]))).toBe('c')
  })

  it('numbers compare equal, greater and less; empty values never match', () => {
    expect(ids(filterRows(rows, fields, [{ key: 'price', op: 'eq', value: '2' }]))).toBe('b')
    expect(ids(filterRows(rows, fields, [{ key: 'price', op: 'gt', value: '2' }]))).toBe('a')
    expect(ids(filterRows(rows, fields, [{ key: 'price', op: 'lt', value: '10.5' }]))).toBe('a,b')
  })

  it('toggles match on, or off including unset', () => {
    expect(ids(filterRows(rows, fields, [{ key: 'vegan', op: 'on' }]))).toBe('b')
    expect(ids(filterRows(rows, fields, [{ key: 'vegan', op: 'off' }]))).toBe('a,c')
  })

  it('dates compare by day, before and after excluding the day itself', () => {
    expect(ids(filterRows(rows, fields, [{ key: 'servedFrom', op: 'before', value: '2026-03-01' }]))).toBe('c')
    expect(ids(filterRows(rows, fields, [{ key: 'servedFrom', op: 'after', value: '2026-01-15' }]))).toBe('a')
  })

  it('combines filters with and', () => {
    expect(ids(filterRows(rows, fields, [{ key: 'price', op: 'lt', value: '20' }, { key: 'vegan', op: 'off' }]))).toBe('a')
  })

  it('ignores a filter without a usable value or whose field is gone', () => {
    expect(ids(filterRows(rows, fields, [{ key: 'price', op: 'gt', value: 'abc' }]))).toBe('a,b,c')
    expect(ids(filterRows(rows, fields, [{ key: 'note', op: 'contains', value: ' ' }]))).toBe('a,b,c')
    expect(ids(filterRows(rows, fields, [{ key: 'gone', op: 'on' }]))).toBe('a,b,c')
  })
})

describe('filterLabel', () => {
  it('reads like a chip', () => {
    expect(filterLabel({ key: 'note', op: 'contains', value: 'milk' }, fields)).toBe('Note contains “milk”')
    expect(filterLabel({ key: 'price', op: 'gt', value: '2' }, fields)).toBe('Price > 2')
    expect(filterLabel({ key: 'vegan', op: 'on' }, fields)).toBe('Vegan is on')
    expect(filterLabel({ key: 'servedFrom', op: 'before', value: '2026-03-01' }, fields)).toBe('Served from before 2026-03-01')
  })
})

describe('tableRows', () => {
  it('filters, then searches, then sorts', () => {
    const shown = tableRows(rows, fields, { query: 'latte', filters: [{ key: 'vegan', op: 'off' }], sort: { key: 'name', direction: 'asc' } })
    expect(ids(shown)).toBe('c,a')
  })

  it('with nothing set keeps the loaded rows', () => {
    expect(tableRows(rows, fields, { query: '', filters: [], sort: null })).toBe(rows)
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

describe('sortRows', () => {
  it('compares per field type, empty values last in both directions', () => {
    expect(ids(sortRows(rows, fields, { key: 'name', direction: 'asc' }))).toBe('b,c,a')
    expect(ids(sortRows(rows, fields, { key: 'name', direction: 'desc' }))).toBe('a,c,b')
    expect(ids(sortRows(rows, fields, { key: 'price', direction: 'asc' }))).toBe('b,a,c')
    expect(ids(sortRows(rows, fields, { key: 'price', direction: 'desc' }))).toBe('a,b,c')
    expect(ids(sortRows(rows, fields, { key: 'vegan', direction: 'asc' }))).toBe('a,b,c')
    expect(ids(sortRows(rows, fields, { key: 'servedFrom', direction: 'asc' }))).toBe('c,a,b')
    expect(ids(sortRows(rows, fields, { key: 'servedFrom', direction: 'desc' }))).toBe('a,c,b')
  })

  it('compares numbers inside text naturally', () => {
    const items: Row[] = [{ id: 'x', name: 'Item 10' }, { id: 'y', name: 'Item 9' }]
    expect(ids(sortRows(items, fields, { key: 'name', direction: 'asc' }))).toBe('y,x')
  })

  it('no sort keeps the loaded order', () => {
    expect(sortRows(rows, fields, null)).toBe(rows)
  })
})

describe('recordsCount', () => {
  it('counts every item', () => {
    expect(recordsCount({ shown: 40, total: 40, narrowed: false })).toBe('40 items')
    expect(recordsCount({ shown: 1, total: 1, narrowed: false })).toBe('1 item')
  })

  it('counts the matches among the loaded items when searching or filtering', () => {
    expect(recordsCount({ shown: 3, total: 40, narrowed: true })).toBe('3 of 40 items')
  })
})

describe('rowId', () => {
  it('is the row\'s id, or its position when it has none', () => {
    expect(rowId({ id: 'a' }, 0)).toBe('a')
    expect(rowId({ id: 7 }, 3)).toBe('7')
    expect(rowId({ title: 'x' }, 3)).toBe('3')
  })
})

describe('cellText', () => {
  it('shows a value the way a cell does: empty for none, a day for a date, Yes/No for a toggle only in the panel', () => {
    expect(cellText('text', null)).toBe('')
    expect(cellText('text', '')).toBe('')
    expect(cellText('number', 3.5)).toBe('3.5')
    expect(cellText('date', '2026-03-01')).toBe('Mar 1, 2026')
    expect(cellText('datetime', '2026-11-01T09:00:00.000Z')).toBe('Nov 1, 2026')
    expect(cellText('date', 'soon')).toBe('soon')
    expect(cellText('boolean', true)).toBe('true')
  })
})

describe('rowsFailure', () => {
  it('says why the app\'s rows are not shown, for each way a read fails', () => {
    expect(rowsFailure('quotes', 'could not be reached')).toBe('The app\'s list route for quotes could not be reached.')
    expect(rowsFailure('quotes', 'did not answer in time (8 s)')).toBe('The app\'s list route for quotes did not answer in time (8 s).')
    expect(rowsFailure('quotes', 'HTTP 502')).toBe('The app\'s list route for quotes answered HTTP 502.')
    expect(rowsFailure('quotes', 'not a page of rows')).toBe('The app\'s list route for quotes did not answer with a page of rows.')
    expect(rowsFailure('quotes', 'has no list route the app answers')).toBe('The app\'s list route for quotes is not exposed: turn on App list in the panel.')
  })
})
