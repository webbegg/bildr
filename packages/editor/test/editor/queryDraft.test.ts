import { describe, expect, it } from 'vitest'
import type { QueryFile } from '@bildr/codegen/model'
import type { QueryField } from '../../src/editor/dataArtifacts.ts'
import { changesOf, draftOf, renameParam, valueOfText } from '../../src/editor/queryDraft.ts'

/** The Query Definition form's draft (S10): what the form shows of a query, and what saving it sends of it. */

const FIELDS: QueryField[] = [
  { name: 'id', type: 'uuid' },
  { name: 'title', type: 'text' },
  { name: 'views', type: 'integer' },
  { name: 'rating', type: 'number' },
  { name: 'published', type: 'boolean' },
  { name: 'createdAt', type: 'datetime' }
]

const query = (patch: Partial<QueryFile> = {}): QueryFile => ({
  id: 'q_featured',
  name: 'featured',
  label: 'Featured',
  from: 'ent_post',
  params: [{ name: 'limit', type: 'integer', default: 6 }],
  where: { op: 'eq', field: 'published', value: true },
  orderBy: [{ field: 'createdAt', direction: 'desc' }],
  limit: { $param: 'limit' },
  result: 'many',
  ...patch
} as QueryFile)

describe('draftOf', () => {
  it('holds a query as text and choices', () => {
    expect(draftOf(query({ description: 'Newest first' }))).toEqual({
      label: 'Featured',
      description: 'Newest first',
      result: 'many',
      params: [{ name: 'limit', type: 'integer', default: '6' }],
      where: { field: 'published', op: 'eq', kind: 'value', value: 'true', param: '' },
      orderBy: [{ field: 'createdAt', direction: 'desc' }],
      limit: { kind: 'param', number: '', param: 'limit' }
    })
  })

  it('holds a condition on a parameter, a list, a number limit and no condition', () => {
    expect(draftOf(query({ where: { op: 'eq', field: 'title', value: { $param: 'title' } } })).where).toMatchObject({ kind: 'param', param: 'title', value: '' })
    expect(draftOf(query({ where: { op: 'in', field: 'views', value: [1, 2, 3] } })).where).toMatchObject({ kind: 'value', value: '1, 2, 3' })
    expect(draftOf(query({ limit: 5 })).limit).toEqual({ kind: 'number', number: '5', param: '' })
    expect(draftOf(query({ where: undefined, limit: undefined, orderBy: undefined })).where).toBeNull()
    expect(draftOf(query({ limit: undefined })).limit.kind).toBe('none')
  })

  it('keeps an expression it does not edit', () => {
    const draft = draftOf(query({ where: { op: 'gte', field: 'createdAt', value: { $now: true } } }))
    expect(draft.where).toMatchObject({ kind: 'expression', expression: { $now: true } })
    expect(changesOf(draft, query({ where: { op: 'gte', field: 'createdAt', value: { $now: true } } }), FIELDS).input).toEqual({})
  })
})

describe('changesOf', () => {
  it('sends nothing for a draft that was not changed', () => {
    expect(changesOf(draftOf(query()), query(), FIELDS)).toEqual({ input: {}, problems: [] })
  })

  it('sends only what changed', () => {
    const draft = { ...draftOf(query()), label: 'Top' }
    expect(changesOf(draft, query(), FIELDS).input).toEqual({ label: 'Top' })
  })

  it('sends a description, or null when it was emptied', () => {
    expect(changesOf({ ...draftOf(query()), description: 'New' }, query(), FIELDS).input).toEqual({ description: 'New' })
    expect(changesOf({ ...draftOf(query({ description: 'Old' })), description: '' }, query({ description: 'Old' }), FIELDS).input).toEqual({ description: null })
  })

  it('types a condition\'s value by the field: integer, number, toggle and text, a list for "is one of"', () => {
    const base = draftOf(query({ where: undefined }))
    const where = (field: string, op: 'eq' | 'in' | 'like' | 'gte', value: string) => changesOf({ ...base, where: { field, op, kind: 'value', value, param: '' } }, query({ where: undefined }), FIELDS).input.where
    expect(where('views', 'gte', '10')).toEqual({ op: 'gte', field: 'views', value: 10 })
    expect(where('rating', 'gte', '1.5')).toEqual({ op: 'gte', field: 'rating', value: 1.5 })
    expect(where('published', 'eq', 'false')).toEqual({ op: 'eq', field: 'published', value: false })
    expect(where('title', 'eq', 'Hello')).toEqual({ op: 'eq', field: 'title', value: 'Hello' })
    expect(where('views', 'in', '1, 2,3')).toEqual({ op: 'in', field: 'views', value: [1, 2, 3] })
    // A pattern is text, whatever the field is.
    expect(where('views', 'like', '1%')).toEqual({ op: 'like', field: 'views', value: '1%' })
  })

  it('names a value that is not of the field\'s type, and sends nothing for the condition', () => {
    const base = draftOf(query({ where: undefined }))
    const found = changesOf({ ...base, where: { field: 'views', op: 'eq', kind: 'value', value: 'many', param: '' } }, query({ where: undefined }), FIELDS)
    expect(found.problems).toEqual(['Condition: the value of views is a whole number'])
    expect(found.input).not.toHaveProperty('where')
  })

  it('removes the condition with null, and the ordering with an empty list', () => {
    expect(changesOf({ ...draftOf(query()), where: null }, query(), FIELDS).input).toEqual({ where: null })
    expect(changesOf({ ...draftOf(query()), orderBy: [] }, query(), FIELDS).input).toEqual({ orderBy: [] })
  })

  it('sends a condition on a parameter', () => {
    const draft = draftOf(query())
    expect(changesOf({ ...draft, where: { field: 'title', op: 'eq', kind: 'param', value: '', param: 'limit' } }, query(), FIELDS).input.where).toEqual({ op: 'eq', field: 'title', value: { $param: 'limit' } })
  })

  it('sends the limit: a whole number, a parameter, or null for none', () => {
    const draft = draftOf(query())
    expect(changesOf({ ...draft, limit: { kind: 'number', number: '12', param: '' } }, query(), FIELDS).input).toEqual({ limit: 12 })
    expect(changesOf({ ...draft, limit: { kind: 'none', number: '', param: '' } }, query(), FIELDS).input).toEqual({ limit: null })
    expect(changesOf({ ...draftOf(query({ limit: 3 })), limit: { kind: 'param', number: '', param: 'limit' } }, query({ limit: 3 }), FIELDS).input).toEqual({ limit: { $param: 'limit' } })
    expect(changesOf({ ...draft, limit: { kind: 'number', number: '1.5', param: '' } }, query(), FIELDS).problems).toEqual(['Limit: enter a whole number'])
  })

  it('sends the whole list of parameters with their defaults typed, keeping a reactive one reactive', () => {
    const draft = draftOf(query({ params: [{ name: 'slug', type: 'text', reactive: true }] }))
    const next = { ...draft, params: [...draft.params, { name: 'min', type: 'integer' as const, default: '5' }, { name: 'on', type: 'boolean' as const, default: 'true' }, { name: 'free', type: 'text' as const, default: '' }] }
    expect(changesOf(next, query({ params: [{ name: 'slug', type: 'text', reactive: true }], where: undefined, limit: undefined }), FIELDS).input.params).toEqual([
      { name: 'slug', type: 'text', reactive: true },
      { name: 'min', type: 'integer', default: 5 },
      { name: 'on', type: 'boolean', default: true },
      { name: 'free', type: 'text' }
    ])
  })

  it('names a default that is not of the parameter\'s type', () => {
    const draft = draftOf(query())
    const found = changesOf({ ...draft, params: [{ name: 'limit', type: 'integer', default: 'six' }] }, query(), FIELDS)
    expect(found.problems).toEqual(['Parameter limit: its default is a whole number'])
  })

  it('does not take a blank label', () => {
    expect(changesOf({ ...draftOf(query()), label: '  ' }, query(), FIELDS).problems).toEqual(['Add a label'])
  })
})

describe('renameParam', () => {
  it('renames the parameter, and the condition and the limit that read it', () => {
    const draft = draftOf(query({ where: { op: 'gt', field: 'views', value: { $param: 'limit' } } }))
    const renamed = renameParam(draft, 0, 'count')
    expect(renamed.params[0]!.name).toBe('count')
    expect(renamed.where).toMatchObject({ kind: 'param', param: 'count' })
    expect(renamed.limit).toMatchObject({ kind: 'param', param: 'count' })
  })

  it('leaves what reads another parameter alone', () => {
    const draft = draftOf(query({ params: [{ name: 'a', type: 'integer' }, { name: 'limit', type: 'integer' }] }))
    const renamed = renameParam(draft, 0, 'b')
    expect(renamed.limit).toMatchObject({ param: 'limit' })
  })
})

describe('valueOfText', () => {
  it.each([
    ['integer', '7', { value: 7 }],
    ['integer', '7.5', { problem: 'a whole number' }],
    ['number', '7.5', { value: 7.5 }],
    ['number', '', { problem: 'a number' }],
    ['boolean', 'true', { value: true }],
    ['boolean', 'yes', { problem: 'true or false' }],
    ['text', ' a ', { value: ' a ' }],
    ['datetime', '2026-11-11T00:00:00.000Z', { value: '2026-11-11T00:00:00.000Z' }]
  ] as const)('%s %j', (type, text, expected) => {
    expect(valueOfText(type, text)).toEqual(expected)
  })
})
