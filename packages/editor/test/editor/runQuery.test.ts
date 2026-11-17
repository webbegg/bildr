import { describe, expect, it } from 'vitest'
import type { QueryFile } from '@bildr/codegen/model'
import { paramDefaults, runQuery } from '../../src/editor/runQuery.ts'

/**
 * The Data workspace's Query Results (S10, DW-7b): a query run over the rows the collection's Rows tab shows. The
 * evaluator is `@bildr/codegen/query`'s (it has a parity test against the real TanStack DB live queries); what is
 * tested here is what the editor adds: the parameter inputs, typed by the parameter's type and prefilled with its
 * default, and the result the Results tab shows.
 */

const rows = [
  { id: 'p1', title: 'Hello bildr', slug: 'hello-bildr', views: 10, published: true, publishedAt: '2026-11-10T09:00:00.000Z' },
  { id: 'p2', title: 'A draft', slug: 'a-draft', views: 3, published: false, publishedAt: null },
  { id: 'p3', title: 'Second post', slug: 'second', views: 25, published: true, publishedAt: '2026-11-12T09:00:00.000Z' },
  { id: 'p4', title: 'Third post', slug: 'third', views: 7, published: true, publishedAt: '2026-11-11T09:00:00.000Z' }
]

const query = (patch: Partial<QueryFile> = {}): QueryFile => ({ id: 'q_x', name: 'x', label: 'X', from: 'ent_post', params: [], result: 'many', ...patch } as QueryFile)
const ids = (found: { rows: Array<Record<string, unknown>> }) => found.rows.map(row => row.id)

describe('runQuery: the condition, the ordering and the limit', () => {
  it('returns every row, in key order, for a query with none', () => {
    expect(ids(runQuery(query(), [...rows].reverse(), {}))).toEqual(['p1', 'p2', 'p3', 'p4'])
  })

  it.each([
    ['eq', 'published', true, ['p1', 'p3', 'p4']],
    ['ne', 'published', true, ['p2']],
    ['lt', 'views', 10, ['p2', 'p4']],
    ['lte', 'views', 10, ['p1', 'p2', 'p4']],
    ['gt', 'views', 10, ['p3']],
    ['gte', 'views', 10, ['p1', 'p3']],
    ['in', 'slug', ['third', 'a-draft', 'nope'], ['p2', 'p4']],
    ['like', 'title', '%post', ['p3', 'p4']],
    ['like', 'slug', 'a-_raft', ['p2']]
  ] as const)('%s on %s %j', (op, field, value, expected) => {
    expect(ids(runQuery(query({ where: { op, field, value: value as never } }), rows, {}))).toEqual(expected)
  })

  it('treats a missing field as matching no condition, ne included', () => {
    expect(ids(runQuery(query({ where: { op: 'ne', field: 'publishedAt', value: 'x' } }), rows, {}))).toEqual(['p1', 'p3', 'p4'])
  })

  it('orders by each field in turn, nulls first, and by direction', () => {
    expect(ids(runQuery(query({ orderBy: [{ field: 'publishedAt', direction: 'desc' }] }), rows, {}))).toEqual(['p2', 'p3', 'p4', 'p1'])
    expect(ids(runQuery(query({ orderBy: [{ field: 'published', direction: 'desc' }, { field: 'views', direction: 'asc' }] }), rows, {}))).toEqual(['p4', 'p1', 'p3', 'p2'])
  })

  it('limits after the condition and the ordering, and says how many rows matched before the limit', () => {
    const found = runQuery(query({ where: { op: 'eq', field: 'published', value: true }, orderBy: [{ field: 'views', direction: 'desc' }], limit: 2 }), rows, {})
    expect(ids(found)).toEqual(['p3', 'p1'])
    expect(found.total).toBe(3)
  })

  it('does not change the rows it is given', () => {
    const copy = structuredClone(rows)
    runQuery(query({ orderBy: [{ field: 'views', direction: 'desc' }], limit: 1 }), rows, {})
    expect(rows).toEqual(copy)
  })
})

describe('runQuery: a query that returns one row', () => {
  const bySlug = query({ result: 'one', params: [{ name: 'slug', type: 'text', reactive: true }], where: { op: 'eq', field: 'slug', value: { $param: 'slug' } } })

  it('shows the first row that matches as the value', () => {
    const found = runQuery(bySlug, rows, { slug: 'second' })
    expect(found.value).toEqual(rows[2])
    expect(ids(found)).toEqual(['p3'])
  })

  it('has no value when nothing matches, or when the parameter has no value', () => {
    expect(runQuery(bySlug, rows, { slug: 'nope' }).value).toBeNull()
    expect(runQuery(bySlug, rows, { slug: '' }).value).toBeNull()
  })
})

describe('runQuery: parameters', () => {
  const featured = query({
    params: [{ name: 'limit', type: 'integer', default: 2 }],
    where: { op: 'eq', field: 'published', value: true },
    orderBy: [{ field: 'views', direction: 'desc' }],
    limit: { $param: 'limit' }
  })

  it('prefills the inputs with the defaults, as text, and a boolean as a boolean', () => {
    expect(paramDefaults(featured)).toEqual({ limit: '2' })
    expect(paramDefaults(query({ params: [
      { name: 'q', type: 'text' },
      { name: 'onlyPublished', type: 'boolean', default: true },
      { name: 'off', type: 'boolean' },
      { name: 'min', type: 'number', default: 1.5 },
      { name: 'since', type: 'datetime', default: '2026-11-11T00:00:00.000Z' }
    ] }))).toEqual({ q: '', onlyPublished: true, off: false, min: '1.5', since: '2026-11-11T00:00:00.000Z' })
  })

  it('reads an integer input as a number: the limit parameter limits the rows', () => {
    expect(ids(runQuery(featured, rows, { limit: '2' }))).toEqual(['p3', 'p1'])
    expect(ids(runQuery(featured, rows, { limit: '1' }))).toEqual(['p3'])
    expect(ids(runQuery(featured, rows, { limit: '0' }))).toEqual([])
  })

  it('uses the default when an input is blank', () => {
    expect(ids(runQuery(featured, rows, { limit: '' }))).toEqual(['p3', 'p1'])
  })

  it('matches nothing for a blank input with no default', () => {
    const by = query({ params: [{ name: 'slug', type: 'text' }], where: { op: 'eq', field: 'slug', value: { $param: 'slug' } } })
    expect(ids(runQuery(by, rows, { slug: '' }))).toEqual([])
  })

  it('compares a number parameter with a number field, and a boolean switch with a boolean field', () => {
    const above = query({ params: [{ name: 'min', type: 'integer' }], where: { op: 'gt', field: 'views', value: { $param: 'min' } } })
    expect(ids(runQuery(above, rows, { min: '9' }))).toEqual(['p1', 'p3'])
    const flag = query({ params: [{ name: 'published', type: 'boolean' }], where: { op: 'eq', field: 'published', value: { $param: 'published' } } })
    expect(ids(runQuery(flag, rows, { published: false }))).toEqual(['p2'])
    expect(ids(runQuery(flag, rows, { published: true }))).toEqual(['p1', 'p3', 'p4'])
  })

  it('names an input that is not a number, shows no rows and does not fall back to the default', () => {
    const found = runQuery(featured, rows, { limit: 'many' })
    expect(found.problems).toEqual({ limit: 'Enter a whole number' })
    expect(found.rows).toEqual([])
    expect(runQuery(featured, rows, { limit: '2.5' }).problems).toEqual({ limit: 'Enter a whole number' })
    const by = query({ params: [{ name: 'min', type: 'number' }], where: { op: 'gt', field: 'views', value: { $param: 'min' } } })
    expect(runQuery(by, rows, { min: 'x' }).problems).toEqual({ min: 'Enter a number' })
    expect(runQuery(by, rows, { min: '1.5' }).problems).toEqual({})
  })

  it('has no problems for valid inputs', () => {
    expect(runQuery(featured, rows, { limit: '3' }).problems).toEqual({})
  })
})
