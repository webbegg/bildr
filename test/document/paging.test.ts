import { describe, expect, it } from 'vitest'
import { CollectionSourceSchema, ListEndpointSchema, PagingSchema } from '#shared/document/schema'

const LIST = { method: 'GET', path: '/character', itemsPath: 'results' }

describe('paging schema', () => {
  it('fills the defaults of page and offset paging', () => {
    expect(PagingSchema.parse({ type: 'page' })).toEqual({ type: 'page', param: 'page', start: 1 })
    expect(PagingSchema.parse({ type: 'offset', size: 50 })).toEqual({ type: 'offset', param: 'offset', sizeParam: 'limit', size: 50 })
    expect(PagingSchema.parse({ type: 'cursor', param: 'after', cursorPath: 'meta.next_cursor', totalPath: 'meta.total' }))
      .toEqual({ type: 'cursor', param: 'after', cursorPath: 'meta.next_cursor', totalPath: 'meta.total' })
    expect(PagingSchema.parse({ type: 'next', nextPath: 'info.next', totalPath: 'info.count' })).toEqual({ type: 'next', nextPath: 'info.next', totalPath: 'info.count' })
    expect(PagingSchema.parse({ type: 'next' })).toEqual({ type: 'next' })
    expect(PagingSchema.parse({ type: 'page', param: 'page[number]', sizeParam: 'page[size]', size: 25 })).toMatchObject({ param: 'page[number]' })
  })

  it('refuses unsafe parameter names, sizes, starts and paths', () => {
    for (const bad of [
      { type: 'page', param: 'a&b' },
      { type: 'page', param: 'a=b' },
      { type: 'page', param: '' },
      { type: 'page', param: 'a b' },
      { type: 'page', start: 2 },
      { type: 'page', sizeParam: 'per_page' },
      { type: 'page', sizeParam: 'page', size: 10 },
      { type: 'offset', size: 0 },
      { type: 'offset', size: 501 },
      { type: 'offset' },
      { type: 'cursor', param: 'cursor', cursorPath: '../x' },
      { type: 'cursor', cursorPath: 'next' },
      { type: 'next', nextPath: 'info..next' },
      { type: 'next', totalPath: 'a b' },
      { type: 'other' }
    ]) expect(PagingSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
  })

  it('is optional on List endpoints and API sources, so stored ones load unchanged', () => {
    expect(ListEndpointSchema.parse(LIST)).toEqual(LIST)
    const api = { type: 'api', url: 'https://rickandmortyapi.com/api/character', itemsPath: 'results' }
    expect(CollectionSourceSchema.parse(api)).toEqual(api)
    const paging = { type: 'next', nextPath: 'info.next', totalPath: 'info.count' }
    expect(ListEndpointSchema.parse({ ...LIST, paging })).toEqual({ ...LIST, paging })
    expect(CollectionSourceSchema.parse({ ...api, paging })).toEqual({ ...api, paging })
    expect(ListEndpointSchema.safeParse({ ...LIST, paging: { type: 'page', param: 'p?' } }).success).toBe(false)
  })
})
