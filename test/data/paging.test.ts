import { describe, expect, it } from 'vitest'
import { detectPaging, nextFrom, nextPageUrl, pageRequest, pagesFor, totalFrom } from '#shared/data/paging'
import type { Paging } from '#shared/data/paging'

const page: Paging = { type: 'page', param: 'page', start: 1, sizeParam: 'per_page', size: 20 }
const offset: Paging = { type: 'offset', param: 'skip', sizeParam: 'limit', size: 30 }
const cursor: Paging = { type: 'cursor', param: 'cursor', cursorPath: 'meta.next_cursor' }
const next: Paging = { type: 'next', nextPath: 'info.next', totalPath: 'info.count' }

describe('pageRequest', () => {
  it('numbers pages from start, with the size when there is a size param', () => {
    expect(pageRequest(page, 0)).toEqual({ page: '1', per_page: '20' })
    expect(pageRequest(page, 2)).toEqual({ page: '3', per_page: '20' })
    expect(pageRequest({ type: 'page', param: 'p', start: 0 }, 2)).toEqual({ p: '2' })
  })

  it('turns a page index into an offset', () => {
    expect(pageRequest(offset, 0)).toEqual({ skip: '0', limit: '30' })
    expect(pageRequest(offset, 3)).toEqual({ skip: '90', limit: '30' })
  })

  it('sends the cursor after the first page, and nothing for next URLs', () => {
    expect(pageRequest(cursor, 0)).toEqual({})
    expect(pageRequest(cursor, 1, 'abc&x=/..')).toEqual({ cursor: 'abc&x=/..' })
    expect(pageRequest(next, 3)).toEqual({})
  })
})

describe('nextFrom and totalFrom', () => {
  it('reads the cursor or the next URL, or null at the end', () => {
    expect(nextFrom(cursor, { meta: { next_cursor: 'c2' } })).toBe('c2')
    expect(nextFrom(cursor, { meta: { next_cursor: 42 } })).toBe('42')
    expect(nextFrom(cursor, { meta: { next_cursor: '' } })).toBeNull()
    expect(nextFrom(cursor, { meta: { next_cursor: null } })).toBeNull()
    expect(nextFrom(next, { info: { next: 'https://rickandmortyapi.com/api/character?page=2' } })).toBe('https://rickandmortyapi.com/api/character?page=2')
    expect(nextFrom(next, { info: { next: null } })).toBeNull()
    expect(nextFrom(page, { page: 1 })).toBeNull()
  })

  it('reads the Link header when a next paging has no nextPath', () => {
    const link = '<https://api.github.com/repos?page=1>; rel="prev", <https://api.github.com/repos?page=3>; rel="next", <https://api.github.com/repos?page=9>; rel="last"'
    expect(nextFrom({ type: 'next' }, [], { link })).toBe('https://api.github.com/repos?page=3')
    expect(nextFrom({ type: 'next' }, [], { link: '</items?after=5>; rel=next' })).toBe('/items?after=5')
    expect(nextFrom({ type: 'next' }, [], { link: '<https://x.example.com/?page=9>; rel="last"' })).toBeNull()
    expect(nextFrom({ type: 'next' }, [])).toBeNull()
  })

  it('reads the total as a number', () => {
    expect(totalFrom(next, { info: { count: 826 } })).toBe(826)
    expect(totalFrom({ ...page, totalPath: 'total' }, { total: '12' })).toBe(12)
    expect(totalFrom({ ...page, totalPath: 'total' }, { total: 'many' })).toBeUndefined()
    expect(totalFrom(page, { total: 12 })).toBeUndefined()
  })
})

describe('pagesFor', () => {
  it('gives the first and last page index a window needs', () => {
    expect(pagesFor(0, 45, 20)).toEqual({ first: 0, last: 2 })
    expect(pagesFor(20, 20, 20)).toEqual({ first: 1, last: 1 })
    expect(pagesFor(25, 1, 10)).toEqual({ first: 2, last: 2 })
  })
})

describe('nextPageUrl', () => {
  const origin = 'https://api.example.com'
  it('resolves relative next URLs against the page URL', () => {
    expect(nextPageUrl('/v1/posts?page=2', 'https://api.example.com/v1/posts', origin)).toBe('https://api.example.com/v1/posts?page=2')
    expect(nextPageUrl('?page=3', 'https://api.example.com/v1/posts?page=2', origin)).toBe('https://api.example.com/v1/posts?page=3')
  })

  it('refuses next URLs on another origin without naming them', () => {
    for (const bad of ['https://evil.com/x', '//evil.com/x', 'https://api.example.com@evil.com/x', 'http://api.example.com/x', 'https://api.example.com:8443/x', 'javascript:alert(1)']) {
      expect(() => nextPageUrl(bad, 'https://api.example.com/v1/posts', origin)).toThrow('The API\'s next page is on another site')
    }
  })
})

describe('detectPaging', () => {
  it('finds info.next with info.count (Rick and Morty)', () => {
    expect(detectPaging({ info: { count: 826, pages: 42, next: 'https://rickandmortyapi.com/api/character?page=2', prev: null }, results: [] }))
      .toEqual({ type: 'next', nextPath: 'info.next', totalPath: 'info.count' })
  })

  it('finds next and links.next URLs', () => {
    expect(detectPaging({ count: 10, next: 'https://x.example.com/?page=2', previous: null, results: [] })).toEqual({ type: 'next', nextPath: 'next', totalPath: 'count' })
    expect(detectPaging({ data: [], links: { next: '/items?page=2' }, meta: { total: 50 } })).toEqual({ type: 'next', nextPath: 'links.next', totalPath: 'meta.total' })
  })

  it('finds cursors', () => {
    expect(detectPaging({ data: [], meta: { next_cursor: 'abc' } })).toEqual({ type: 'cursor', param: 'cursor', cursorPath: 'meta.next_cursor' })
    expect(detectPaging({ items: [], next_cursor: 'abc' })).toEqual({ type: 'cursor', param: 'cursor', cursorPath: 'next_cursor' })
  })

  it('finds page numbers with per_page and total', () => {
    expect(detectPaging({ page: 1, per_page: 6, total: 12, total_pages: 2, data: [] }))
      .toEqual({ type: 'page', param: 'page', start: 1, sizeParam: 'per_page', size: 6, totalPath: 'total' })
    expect(detectPaging({ data: [], meta: { current_page: 1, per_page: 15, total: 40 } }))
      .toEqual({ type: 'page', param: 'page', start: 1, sizeParam: 'per_page', size: 15, totalPath: 'meta.total' })
    expect(detectPaging({ data: [], meta: { total: 40 } })).toEqual({ type: 'page', param: 'page', start: 1, totalPath: 'meta.total' })
  })

  it('finds skip or offset with limit', () => {
    expect(detectPaging({ products: [], total: 194, skip: 0, limit: 30 })).toEqual({ type: 'offset', param: 'skip', sizeParam: 'limit', size: 30, totalPath: 'total' })
    expect(detectPaging([], {}, 'https://x.example.com/items?offset=0&limit=25')).toEqual({ type: 'offset', param: 'offset', sizeParam: 'limit', size: 25 })
  })

  it('finds an RFC 5988 Link header', () => {
    expect(detectPaging([{ id: 1 }], { link: '<https://api.github.com/repos?page=2>; rel="next"' })).toEqual({ type: 'next' })
  })

  it('proposes nothing for a plain list', () => {
    expect(detectPaging([{ id: 1 }])).toBeNull()
    expect(detectPaging({ data: [{ id: 1 }] })).toBeNull()
    expect(detectPaging('text')).toBeNull()
  })
})
