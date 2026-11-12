import { describe, expect, it } from 'vitest'
import type { DataRecord } from '#shared/data/records'
import { createCollection, createNode } from '#shared/document/factory'
import { listQueryOf } from '#shared/runtime/list'
import { listSlice, mergePage, nextPageSearch } from '#shared/runtime/loadMore'

const posts = createCollection('Posts', 'posts', [{ key: 'title', label: 'Title', type: 'text' }])

const rec = (n: number): DataRecord => ({ id: `r${n}`, createdAt: `2026-11-12T10:00:0${n}Z`, updatedAt: '2026-11-12T10:00:00Z', values: { title: `Post ${n}` } })
const seven = [1, 2, 3, 4, 5, 6, 7].map(rec)
const ids = (records: DataRecord[]) => records.map(r => r.id)

const query = listQueryOf(createNode('List', { collection: 'posts', limit: 3, loadMore: true, sortField: 'title', sortDir: 'desc', filterField: 'title', filterValue: 'x' }).props)

describe('nextPageSearch', () => {
  it('reads the next limit records after those loaded, with the same sort and filter', () => {
    expect(nextPageSearch(query, { records: seven.slice(0, 3), more: true })).toBe('limit=3&offset=3&sort=title&dir=desc&filter%5Btitle%5D=x')
    expect(nextPageSearch(query, { records: seven.slice(0, 6), more: true })).toContain('offset=6')
  })
})

describe('mergePage', () => {
  it('starts from the first page: more while fewer than the total are loaded', () => {
    expect(mergePage(undefined, { records: seven.slice(0, 3), total: 7 })).toEqual({ records: seven.slice(0, 3), more: true })
    expect(mergePage(undefined, { records: seven.slice(0, 3), total: 3 })).toEqual({ records: seven.slice(0, 3), more: false })
    expect(mergePage(undefined, { records: [], total: 0 })).toEqual({ records: [], more: false })
  })

  it('appends later pages until the total is loaded: 3, then 6, then 7', () => {
    const first = mergePage(undefined, { records: seven.slice(0, 3), total: 7 })
    const second = mergePage(first, { records: seven.slice(3, 6), total: 7 })
    expect(ids(second.records)).toEqual(['r1', 'r2', 'r3', 'r4', 'r5', 'r6'])
    expect(second.more).toBe(true)
    const third = mergePage(second, { records: seven.slice(6), total: 7 })
    expect(ids(third.records)).toEqual(ids(seven))
    expect(third.more).toBe(false)
  })

  it('follows hasMore when the server sends it (paged collections, whose total may be unknown)', () => {
    expect(mergePage(undefined, { records: seven.slice(0, 3), total: 3, hasMore: true }).more).toBe(true)
    expect(mergePage(undefined, { records: seven.slice(0, 3), total: 100, hasMore: false }).more).toBe(false)
  })

  it('drops records already loaded and stops when a page brings nothing new', () => {
    const first = mergePage(undefined, { records: seven.slice(0, 3), total: 7 })
    const overlap = mergePage(first, { records: seven.slice(2, 5), total: 7 })
    expect(ids(overlap.records)).toEqual(['r1', 'r2', 'r3', 'r4', 'r5'])
    expect(overlap.more).toBe(true)
    expect(mergePage(first, { records: seven.slice(0, 3), total: 7, hasMore: true })).toEqual({ records: first.records, more: false })
    expect(mergePage(first, { records: [], total: 7, hasMore: true }).more).toBe(false)
  })
})

describe('listSlice', () => {
  const byTitle = listQueryOf(createNode('List', { collection: 'posts', limit: 3, loadMore: true }).props)

  it('shows the first count records of the query and whether more of the loaded ones match', () => {
    expect(listSlice(posts, seven, byTitle, 3)).toEqual({ records: seven.slice(0, 3), more: true })
    expect(ids(listSlice(posts, seven, byTitle, 6).records)).toEqual(['r1', 'r2', 'r3', 'r4', 'r5', 'r6'])
    expect(listSlice(posts, seven, byTitle, 9)).toEqual({ records: seven, more: false })
  })

  it('shows nothing when the query does not fit the collection', () => {
    const unknownSort = listQueryOf(createNode('List', { collection: 'posts', limit: 3, sortField: 'colour' }).props)
    expect(listSlice(posts, seven, unknownSort, 3)).toEqual({ records: [], more: false })
  })
})
