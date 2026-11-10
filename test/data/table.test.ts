import { describe, expect, it } from 'vitest'
import { cellInput, draftPaging, filterLabel, filterOps, filterRecords, loadMoreLimit, moveCell, moveForKey, nextSort, pageTwoText, pagingDraft, pagingSummary, parseCell, recordsCount, retypeDraft, searchRecords, selectRows, sortRecords, tableLimit, tableRows } from '#shared/data/table'
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

describe('filterOps', () => {
  it('offers the filters that fit each field type', () => {
    expect(filterOps('text')).toEqual(['contains'])
    expect(filterOps('number')).toEqual(['eq', 'gt', 'lt'])
    expect(filterOps('boolean')).toEqual(['on', 'off'])
    expect(filterOps('date')).toEqual(['before', 'after'])
    expect(filterOps('image')).toEqual([])
  })
})

describe('filterRecords', () => {
  it('text contains ignores case', () => {
    expect(ids(filterRecords(records, fields, [{ key: 'note', op: 'contains', value: 'MILK' }]))).toBe('c')
  })

  it('numbers compare equal, greater and less; empty values never match', () => {
    expect(ids(filterRecords(records, fields, [{ key: 'price', op: 'eq', value: '2' }]))).toBe('b')
    expect(ids(filterRecords(records, fields, [{ key: 'price', op: 'gt', value: '2' }]))).toBe('a')
    expect(ids(filterRecords(records, fields, [{ key: 'price', op: 'lt', value: '10.5' }]))).toBe('a,b')
  })

  it('toggles match on, or off including unset', () => {
    expect(ids(filterRecords(records, fields, [{ key: 'vegan', op: 'on' }]))).toBe('b')
    expect(ids(filterRecords(records, fields, [{ key: 'vegan', op: 'off' }]))).toBe('a,c')
  })

  it('dates compare by day, before and after excluding the day itself', () => {
    expect(ids(filterRecords(records, fields, [{ key: 'servedFrom', op: 'before', value: '2026-03-01' }]))).toBe('c')
    expect(ids(filterRecords(records, fields, [{ key: 'servedFrom', op: 'after', value: '2026-01-15' }]))).toBe('a')
  })

  it('combines filters with and', () => {
    expect(ids(filterRecords(records, fields, [{ key: 'price', op: 'lt', value: '20' }, { key: 'vegan', op: 'off' }]))).toBe('a')
  })

  it('ignores a filter without a usable value or whose field is gone', () => {
    expect(ids(filterRecords(records, fields, [{ key: 'price', op: 'gt', value: 'abc' }]))).toBe('a,b,c')
    expect(ids(filterRecords(records, fields, [{ key: 'note', op: 'contains', value: ' ' }]))).toBe('a,b,c')
    expect(ids(filterRecords(records, fields, [{ key: 'gone', op: 'on' }]))).toBe('a,b,c')
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
    const shown = tableRows(records, fields, { query: 'latte', filters: [{ key: 'vegan', op: 'off' }], sort: { key: 'name', direction: 'asc' } })
    expect(ids(shown)).toBe('c,a')
  })

  it('with nothing set keeps the loaded records', () => {
    expect(tableRows(records, fields, { query: '', filters: [], sort: null })).toBe(records)
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

describe('recordsCount', () => {
  const base = { shown: 40, loaded: 40, total: 40, hasMore: false, totalKnown: true, narrowed: false }

  it('counts every item when all are loaded', () => {
    expect(recordsCount(base)).toBe('40 items')
    expect(recordsCount({ ...base, shown: 1, loaded: 1, total: 1 })).toBe('1 item')
  })

  it('reads "40 of 826 items" when the total is known and more follow', () => {
    expect(recordsCount({ ...base, total: 826, hasMore: true })).toBe('40 of 826 items')
    expect(recordsCount({ ...base, loaded: 500, shown: 500, total: 1200 })).toBe('500 of 1200 items')
  })

  it('reads "40 loaded · more available" when more follow but the total is unknown', () => {
    expect(recordsCount({ ...base, total: 60, hasMore: true, totalKnown: false })).toBe('40 loaded · more available')
  })

  it('counts the matches among the loaded items when searching or filtering', () => {
    expect(recordsCount({ ...base, shown: 3, narrowed: true })).toBe('3 of 40 items')
    expect(recordsCount({ ...base, shown: 3, total: 826, hasMore: true, narrowed: true })).toBe('3 of 40 loaded')
  })
})

describe('tableLimit and loadMoreLimit', () => {
  it('loads 50 at first for a paged collection and 500 for any other', () => {
    expect(tableLimit({ type: 'next', nextPath: 'info.next' })).toBe(50)
    expect(tableLimit(undefined)).toBe(500)
  })

  it('Load more extends the limit by the page size, or 50, up to 500', () => {
    expect(loadMoreLimit(50, { type: 'next', nextPath: 'info.next' })).toBe(100)
    expect(loadMoreLimit(50, { type: 'offset', param: 'offset', sizeParam: 'limit', size: 20 })).toBe(70)
    expect(loadMoreLimit(50, { type: 'page', param: 'page', start: 1 })).toBe(100)
    expect(loadMoreLimit(480, { type: 'page', param: 'page', start: 1, sizeParam: 'per_page', size: 30 })).toBe(500)
  })

  it('has nothing more to load at 500', () => {
    expect(loadMoreLimit(500, { type: 'next' })).toBeNull()
    expect(loadMoreLimit(500, undefined)).toBeNull()
  })
})

describe('paging drafts', () => {
  it('a saved paging fills the draft; none gives the None draft', () => {
    expect(pagingDraft({ type: 'next', nextPath: 'info.next', totalPath: 'info.count' })).toMatchObject({ type: 'next', nextPath: 'info.next', totalPath: 'info.count' })
    expect(pagingDraft({ type: 'page', param: 'p', start: 0, sizeParam: 'per_page', size: 20 })).toMatchObject({ type: 'page', param: 'p', start: '0', sizeParam: 'per_page', size: '20' })
    expect(pagingDraft(undefined).type).toBe('none')
  })

  it('a valid draft gives its paging, with the defaults', () => {
    expect(draftPaging(pagingDraft({ type: 'next', nextPath: 'info.next', totalPath: 'info.count' }))).toEqual({ paging: { type: 'next', nextPath: 'info.next', totalPath: 'info.count' } })
    expect(draftPaging(retypeDraft(pagingDraft(undefined), 'page'))).toEqual({ paging: { type: 'page', param: 'page', start: 1 } })
    expect(draftPaging({ ...retypeDraft(pagingDraft(undefined), 'offset'), size: '20' })).toEqual({ paging: { type: 'offset', param: 'offset', sizeParam: 'limit', size: 20 } })
    expect(draftPaging({ ...retypeDraft(pagingDraft(undefined), 'next'), nextPath: ' ' })).toEqual({ paging: { type: 'next' } })
    expect(draftPaging(pagingDraft(undefined))).toEqual({ paging: null })
  })

  it('names what an incomplete or invalid draft lacks', () => {
    expect(draftPaging(retypeDraft(pagingDraft(undefined), 'offset'))).toEqual({ problem: 'Set the page size' })
    expect(draftPaging({ ...retypeDraft(pagingDraft(undefined), 'offset'), size: '900' })).toEqual({ problem: 'Use a page size from 1 to 500' })
    expect(draftPaging(retypeDraft(pagingDraft(undefined), 'cursor'))).toEqual({ problem: 'Set where the next cursor is in the response' })
    expect(draftPaging({ ...retypeDraft(pagingDraft(undefined), 'page'), param: 'page number' })).toEqual({ problem: 'Use a query parameter name such as page or per_page' })
    expect(draftPaging({ ...retypeDraft(pagingDraft(undefined), 'page'), sizeParam: 'per_page' })).toEqual({ problem: 'Set the page size sent in the size parameter' })
  })

  it('another type keeps the total path and starts from that type\'s defaults', () => {
    const draft = retypeDraft(pagingDraft({ type: 'next', nextPath: 'info.next', totalPath: 'info.count' }), 'offset')
    expect(draft).toMatchObject({ type: 'offset', param: 'offset', sizeParam: 'limit', totalPath: 'info.count' })
  })
})

describe('pagingSummary and pageTwoText', () => {
  it('names the paging type, where it reads the next page and the total', () => {
    expect(pagingSummary({ type: 'next', nextPath: 'info.next', totalPath: 'info.count' })).toBe('Next link (info.next) · total at info.count')
    expect(pagingSummary({ type: 'next' })).toBe('Next link (Link header)')
    expect(pagingSummary({ type: 'page', param: 'page', start: 1, sizeParam: 'per_page', size: 20 })).toBe('Page number (page, per_page=20)')
    expect(pagingSummary({ type: 'offset', param: 'skip', sizeParam: 'limit', size: 30 })).toBe('Offset (skip, limit=30)')
    expect(pagingSummary({ type: 'cursor', param: 'cursor', cursorPath: 'meta.next_cursor' })).toBe('Cursor (meta.next_cursor)')
  })

  it('reads page two\'s item count or its error', () => {
    expect(pageTwoText({ count: 20, sample: [] })).toEqual({ ok: true, text: 'Page 2: 20 items' })
    expect(pageTwoText({ count: 1, sample: [] })).toEqual({ ok: true, text: 'Page 2: 1 item' })
    expect(pageTwoText({ error: 'The API\'s next page is on another site' })).toEqual({ ok: false, text: 'The API\'s next page is on another site' })
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
