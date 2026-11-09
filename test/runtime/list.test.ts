import { describe, expect, it } from 'vitest'
import type { DataRecord } from '#shared/data/records'
import { createCollection, createNode, createPage } from '#shared/document/factory'
import { listKey, listNodes, listQueryOf, listRecords, listSearch, parseListSearch } from '#shared/runtime/list'

const menu = createCollection('Menu', 'menu', [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'price', label: 'Price', type: 'number' },
  { key: 'vegan', label: 'Vegan', type: 'boolean' }
])

function record(id: string, values: DataRecord['values']): DataRecord {
  return { id, createdAt: `2026-11-09T10:00:0${id.at(-1)}Z`, updatedAt: '2026-11-09T10:00:00Z', values }
}

const records = [
  record('r1', { name: 'Latte', price: 4, vegan: false }),
  record('r2', { name: 'Espresso', price: 2.5, vegan: true }),
  record('r3', { name: 'Mocha', price: 4.5, vegan: true, secret: 'hidden' })
]

describe('listQueryOf', () => {
  it('reads the List props, clamping the limit to 1–100', () => {
    expect(listQueryOf(createNode('List', { collection: 'menu', limit: 500 }).props)).toMatchObject({ collection: 'menu', limit: 100 })
    expect(listQueryOf(createNode('List', { limit: 0 }).props).limit).toBe(1)
    expect(listQueryOf(createNode('List', { limit: 2.7 }).props).limit).toBe(2)
  })

  it('gives Lists with the same query the same key', () => {
    const a = listQueryOf(createNode('List', { collection: 'menu', sortField: 'price' }).props)
    const b = listQueryOf(createNode('List', { collection: 'menu', sortField: 'price' }).props)
    const c = listQueryOf(createNode('List', { collection: 'menu', sortField: 'name' }).props)
    expect(listKey(a)).toBe(listKey(b))
    expect(listKey(a)).not.toBe(listKey(c))
  })
})

describe('listRecords', () => {
  const query = (props: Record<string, string | number>) => listQueryOf(createNode('List', { collection: 'menu', ...props }).props)

  it('sorts, filters with typed values and limits', () => {
    expect(listRecords(menu, records, query({ sortField: 'price' })).map(r => r.id)).toEqual(['r2', 'r1', 'r3'])
    expect(listRecords(menu, records, query({ sortField: 'price', sortDir: 'desc', limit: 2 })).map(r => r.id)).toEqual(['r3', 'r1'])
    expect(listRecords(menu, records, query({ filterField: 'vegan', filterValue: 'true' })).map(r => r.id)).toEqual(['r2', 'r3'])
  })

  it('reads only the declared fields', () => {
    expect(listRecords(menu, records, query({}))[2]!.values).toEqual({ name: 'Mocha', price: 4.5, vegan: true })
  })

  it('lists nothing when the filter value does not fit the field or the sort field is unknown', () => {
    expect(listRecords(menu, records, query({ filterField: 'price', filterValue: 'cheap' }))).toEqual([])
    expect(listRecords(menu, records, query({ sortField: 'colour' }))).toEqual([])
  })
})

describe('listSearch and parseListSearch', () => {
  it('round-trips a List query through URL search params', () => {
    const q = listQueryOf(createNode('List', { collection: 'menu', limit: 5, sortField: 'price', sortDir: 'desc', filterField: 'vegan', filterValue: 'true' }).props)
    const search = listSearch(q)
    expect(search).toBe('limit=5&sort=price&dir=desc&filter%5Bvegan%5D=true')
    expect(parseListSearch(Object.fromEntries(new URLSearchParams(search)))).toEqual({
      query: { limit: 5, offset: 0, sortField: 'price', sortDir: 'desc', filter: { vegan: 'true' } }
    })
  })

  it('defaults to the cap and caps larger limits at 100', () => {
    expect(parseListSearch({})).toEqual({ query: { limit: 100, offset: 0, sortField: '', sortDir: 'asc', filter: {} } })
    expect(parseListSearch({ limit: '1000' })).toMatchObject({ query: { limit: 100 } })
  })

  it('reports malformed params', () => {
    expect(parseListSearch({ limit: 'many' })).toEqual({ problem: '"limit" must be a whole number from 1' })
    expect(parseListSearch({ offset: '-1' })).toEqual({ problem: '"offset" must be a whole number from 0' })
    expect(parseListSearch({ dir: 'up' })).toEqual({ problem: '"dir" must be asc or desc' })
  })
})

describe('listNodes', () => {
  it('finds every List on a page, nested ones included', () => {
    const page = createPage('Home')
    const outer = createNode('List', { collection: 'menu' })
    const inner = createNode('List', { collection: 'extras' })
    outer.children.push(inner)
    page.root.children.push(createNode('Text'), outer)
    expect(listNodes(page.root).map(n => n.props.collection)).toEqual(['menu', 'extras'])
  })
})
