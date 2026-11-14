import { describe, expect, it } from 'vitest'
import { evaluateQuery } from '../../src/query/index'
import type { QueryShape } from '../../src/query/index'

const posts = [
  { id: 'a', title: 'Alpha', n: 3, published: true, slug: 'a', at: '2026-01-02T00:00:00.000Z' },
  { id: 'b', title: 'beta', n: null, published: false, slug: 'b', at: null },
  { id: 'c', title: 'Gamma', n: 1, published: true, slug: null, at: '2026-01-01T00:00:00.000Z' },
  { id: 'd', title: 'Delta', n: 2, published: true, slug: 'd', at: '2026-01-03T00:00:00.000Z' }
]
const ids = (shape: Partial<QueryShape>, args?: Record<string, unknown>) =>
  evaluateQuery({ params: [], result: 'many', ...shape }, posts, args).rows.map(row => row.id)

describe('evaluateQuery (the generated queries\' semantics, V4)', () => {
  it('returns every row, in order, when the query has no condition', () => {
    expect(ids({})).toEqual(['a', 'b', 'c', 'd'])
  })

  it('filters with eq, ne, gt, in and like; a null field matches nothing', () => {
    expect(ids({ where: { op: 'eq', field: 'published', value: true } })).toEqual(['a', 'c', 'd'])
    expect(ids({ where: { op: 'ne', field: 'slug', value: 'b' } })).toEqual(['a', 'd'])
    expect(ids({ where: { op: 'gt', field: 'n', value: 1 } })).toEqual(['a', 'd'])
    expect(ids({ where: { op: 'in', field: 'id', value: ['a', 'c'] } })).toEqual(['a', 'c'])
    expect(ids({ where: { op: 'like', field: 'title', value: '%ta' } })).toEqual(['b', 'd'])
    expect(ids({ where: { op: 'like', field: 'title', value: 'a%' } })).toEqual([])
    expect(ids({ where: { op: 'like', field: 'title', value: '_amma' } })).toEqual(['c'])
  })

  it('orders with nulls first both ways and words case-insensitively', () => {
    expect(ids({ orderBy: [{ field: 'n', direction: 'asc' }] })).toEqual(['b', 'c', 'd', 'a'])
    expect(ids({ orderBy: [{ field: 'n', direction: 'desc' }] })).toEqual(['b', 'a', 'd', 'c'])
    expect(ids({ orderBy: [{ field: 'title', direction: 'asc' }] })).toEqual(['a', 'b', 'd', 'c'])
    expect(ids({ orderBy: [{ field: 'published', direction: 'asc' }, { field: 'at', direction: 'desc' }] })).toEqual(['b', 'd', 'a', 'c'])
  })

  it('limits after ordering, from a number or a parameter with its default', () => {
    const orderBy: QueryShape['orderBy'] = [{ field: 'id', direction: 'desc' }]
    expect(ids({ orderBy, limit: 2 })).toEqual(['d', 'c'])
    const params: QueryShape['params'] = [{ name: 'limit', type: 'integer', default: 3 }]
    expect(ids({ orderBy, params, limit: { $param: 'limit' } })).toEqual(['d', 'c', 'b'])
    expect(ids({ orderBy, params, limit: { $param: 'limit' } }, { limit: 1 })).toEqual(['d'])
  })

  it('orders a limited query by its key when it has no ordering of its own (as the generated query does)', () => {
    const shuffled = [posts[3]!, posts[0]!, posts[2]!, posts[1]!]
    const run = evaluateQuery({ params: [], limit: 2, result: 'many' }, shuffled)
    expect(run.rows.map(row => row.id)).toEqual(['a', 'b'])
  })

  it('compares words by code unit in a condition (capitals before lower case), as the app\'s live query does', () => {
    expect(ids({ where: { op: 'lt', field: 'title', value: 'beta' } })).toEqual(['a', 'c', 'd'])
    expect(ids({ where: { op: 'gte', field: 'title', value: 'B' } })).toEqual(['b', 'c', 'd'])
    expect(ids({ where: { op: 'lte', field: 'title', value: 'Delta' } })).toEqual(['a', 'd'])
  })

  it('reads a parameter in the condition, and a missing one matches nothing', () => {
    const params: QueryShape['params'] = [{ name: 'slug', type: 'text', reactive: true }]
    const where: QueryShape['where'] = { op: 'eq', field: 'slug', value: { $param: 'slug' } }
    expect(ids({ params, where }, { slug: 'd' })).toEqual(['d'])
    expect(ids({ params, where })).toEqual([])
  })

  it('counts the rows that matched before the limit, and a `one` query is its first row or null', () => {
    const run = evaluateQuery({ params: [], where: { op: 'eq', field: 'published', value: true }, limit: 1, result: 'many' }, posts)
    expect(run.total).toBe(3)
    expect(run.rows).toHaveLength(1)
    expect(evaluateQuery({ params: [], where: { op: 'eq', field: 'id', value: 'd' }, result: 'one' }, posts).value).toMatchObject({ id: 'd' })
    expect(evaluateQuery({ params: [], where: { op: 'eq', field: 'id', value: 'zz' }, result: 'one' }, posts).value).toBeNull()
  })

  it('never changes the rows it is given', () => {
    const copy = structuredClone(posts)
    ids({ orderBy: [{ field: 'n', direction: 'desc' }], limit: 1 })
    expect(posts).toEqual(copy)
  })
})
