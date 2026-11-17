import { describe, expect, it } from 'vitest'
import type { QueryFile } from '@bildr/codegen/model'
import type { QueryField } from '../../src/shared/dataArtifacts.ts'
import { changesOf, conditionText, draftOf, orderText, renameParam, summaryOf, valueOfText } from '../../src/editor/queryDraft.ts'

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

describe('changesOf: what the user did not touch is kept as it is stored', () => {
  /** The query as stored, the form opened on it, and one control edited: what saving sends. */
  const saved = (stored: QueryFile, edit: (draft: ReturnType<typeof draftOf>) => void, fields: readonly QueryField[] = FIELDS) => {
    const draft = draftOf(stored)
    edit(draft)
    return changesOf(draft, stored, fields)
  }

  it('sends only the label for a label-only save', () => {
    expect(saved(query(), (draft) => {
      draft.label = 'Top'
    })).toEqual({ input: { label: 'Top' }, problems: [] })
  })

  it('does not let a null literal on a number field block a label save, and does not resend it', () => {
    const stored = query({ where: { op: 'gt', field: 'views', value: null as never } })
    expect(saved(stored, (draft) => {
      draft.label = 'Top'
    })).toEqual({ input: { label: 'Top' }, problems: [] })
  })

  it('keeps a literal that is not of its field\'s type (a hand-edited file) when something else changes', () => {
    const stored = query({ where: { op: 'gt', field: 'views', value: 'many' } })
    expect(saved(stored, (draft) => {
      draft.orderBy = []
    })).toEqual({ input: { orderBy: [] }, problems: [] })
  })

  it('keeps a condition on a field the collection does not have, with its literal as stored', () => {
    const stored = query({ where: { op: 'eq', field: 'gone', value: 5 } })
    expect(saved(stored, (draft) => {
      draft.description = 'Still here'
    })).toEqual({ input: { description: 'Still here' }, problems: [] })
  })

  it('keeps a default and a limit that do not survive the text', () => {
    const stored = query({ params: [{ name: 'limit', type: 'integer', default: null as never }], limit: 2.5 as never })
    expect(saved(stored, (draft) => {
      draft.label = 'Top'
    })).toEqual({ input: { label: 'Top' }, problems: [] })
  })

  it('keeps a parameter it did not touch as stored when another is added', () => {
    const stored = query({ params: [{ name: 'limit', type: 'integer', default: null as never }] })
    const found = saved(stored, (draft) => {
      draft.params.push({ name: 'min', type: 'integer', default: '5' })
    })
    expect(found.input.params).toEqual([{ name: 'limit', type: 'integer', default: null }, { name: 'min', type: 'integer', default: 5 }])
  })

  it('still converts the control that was edited, and names what is wrong with it', () => {
    const stored = query({ where: { op: 'gt', field: 'views', value: null as never } })
    const found = saved(stored, (draft) => {
      draft.where!.value = 'lots'
    })
    expect(found.problems).toEqual(['Condition: the value of views is a whole number'])
    expect(saved(stored, (draft) => {
      draft.where!.value = '12'
    }).input).toEqual({ where: { op: 'gt', field: 'views', value: 12 } })
  })

  it('keeps the literal when only the operator changed and the value text was left alone', () => {
    const stored = query({ where: { op: 'gt', field: 'views', value: null as never } })
    expect(saved(stored, (draft) => {
      draft.where!.op = 'lt'
    })).toEqual({ input: { where: { op: 'lt', field: 'views', value: null } }, problems: [] })
  })

  it('sends the condition and the limit that read a parameter along with the renamed parameter', () => {
    const stored = query({ where: { op: 'gt', field: 'views', value: { $param: 'limit' } } })
    const draft = renameParam(draftOf(stored), 0, 'count')
    expect(changesOf(draft, stored, FIELDS).input).toEqual({
      params: [{ name: 'count', type: 'integer', default: 6 }],
      where: { op: 'gt', field: 'views', value: { $param: 'count' } },
      limit: { $param: 'count' }
    })
  })
})

describe('the query in words', () => {
  const words = (patch: Partial<QueryFile>) => summaryOf(draftOf(query(patch)), FIELDS)

  it('says a condition: the field, the operator as the form words it, and the value', () => {
    const where = (value: Partial<QueryFile>['where']) => conditionText(draftOf(query({ where: value })).where!)
    expect(where({ op: 'lt', field: 'views', value: 5 })).toBe('views is less than 5')
    expect(where({ op: 'eq', field: 'published', value: true })).toBe('published is true')
    expect(where({ op: 'in', field: 'views', value: [1, 2] })).toBe('views is one of 1, 2')
    expect(where({ op: 'like', field: 'title', value: 'a%' })).toBe('title matches a%')
    expect(where({ op: 'eq', field: 'title', value: { $param: 'slug' } })).toBe('title is the “slug” parameter')
    expect(where({ op: 'gte', field: 'createdAt', value: { $now: true } })).toBe('createdAt is at least a computed value')
  })

  it('says an ordering: newest or oldest first for a date, else ascending or descending', () => {
    const order = (orderBy: Array<{ field: string, direction: 'asc' | 'desc' }>) => orderText(orderBy, FIELDS)
    expect(order([{ field: 'createdAt', direction: 'desc' }])).toBe('newest first')
    expect(order([{ field: 'createdAt', direction: 'asc' }])).toBe('oldest first')
    expect(order([{ field: 'title', direction: 'asc' }])).toBe('title ascending')
    expect(order([{ field: 'views', direction: 'desc' }, { field: 'title', direction: 'asc' }])).toBe('views descending, then title ascending')
    expect(order([])).toBe('')
  })

  it('sums the query up in one line: condition · ordering · limit', () => {
    expect(words({ where: { op: 'lt', field: 'views', value: 5 }, orderBy: [{ field: 'createdAt', direction: 'desc' }], limit: 6 })).toBe('views is less than 5 · newest first · limit 6')
  })

  it('says a limit from a parameter by its default, or by the parameter when it has none', () => {
    expect(words({ where: undefined, orderBy: undefined })).toBe('limit 6')
    expect(words({ where: undefined, orderBy: undefined, params: [{ name: 'limit', type: 'integer' }] })).toBe('limit set by “limit”')
  })

  it('says every row for a query with no condition, ordering or limit', () => {
    expect(words({ where: undefined, orderBy: undefined, limit: undefined })).toBe('Every row')
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
