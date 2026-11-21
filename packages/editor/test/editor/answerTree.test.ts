import { describe, expect, it } from 'vitest'
import { answerLists, initialOpen, rowId, treeRows } from '../../src/editor/answerTree.ts'

/**
 * Try it's answer as a tree (api-calls T2, S5): the lists in it that a query can take its items from (by a dotted path, as "Where the list
 * is" reads), one of them recommended; and the rows of the tree, folded as the user left them.
 */

const ANSWER = {
  meta: { total: 2, tags: ['a', 'b'] },
  data: { page: 1, items: [{ id: 1, title: 'Lamp' }, { id: 2, title: 'Desk', parts: [{ id: 9 }] }] },
  others: ['x']
}

describe('the lists of an answer', () => {
  it('are the lists of objects under keys, by dotted path, the one most like the items first and recommended', () => {
    expect(answerLists(ANSWER)).toEqual([
      { path: 'data.items', count: 2, recommended: true }
    ])
  })

  it('recommend what the module finds at the top before a list named like items further down', () => {
    expect(answerLists({ ...ANSWER, rows: [{ x: 1 }] })[0]).toEqual({ path: 'rows', count: 1, recommended: true })
  })

  it('recommend a top-level list as the module finds it, and the answer itself when it is the list', () => {
    expect(answerLists({ results: [{ a: 1 }], more: { data: [{ b: 1 }] } })).toEqual([
      { path: 'results', count: 1, recommended: true },
      { path: 'more.data', count: 1, recommended: false }
    ])
    expect(answerLists([{ a: 1 }, { a: 2 }])).toEqual([{ path: '', count: 2, recommended: true }])
  })

  it('recommend the first list found, going down, when none is named like items', () => {
    expect(answerLists({ a: { b: { posts: [{ id: 1 }] } }, c: { d: [{ id: 2 }] } })).toEqual([
      { path: 'c.d', count: 1, recommended: true },
      { path: 'a.b.posts', count: 1, recommended: false }
    ])
  })

  it('leave out lists of plain values, lists inside a list and keys a dotted path can\'t name', () => {
    expect(answerLists({ 'tags': ['a'], 'odd.key': [{ a: 1 }], 'a b': [{ a: 1 }], 'rows': [[{ a: 1 }]] })).toEqual([])
    expect(answerLists('text')).toEqual([])
    expect(answerLists(null)).toEqual([])
  })
})

describe('the rows of the tree', () => {
  const lists = answerLists(ANSWER)

  it('open the way to the recommended list, the rest folded', () => {
    const open = initialOpen(ANSWER, lists)
    const rows = treeRows(ANSWER, open, lists)
    expect(rows.map(row => `${'  '.repeat(row.depth)}${row.key} ${row.summary}${row.open ? ' (open)' : ''}${row.list ? ` [list${row.list.recommended ? ', recommended' : ''}]` : ''}`)).toEqual([
      'meta 2 fields',
      'data 2 fields (open)',
      '  page 1',
      '  items 2 items (open) [list, recommended]',
      '    0 2 fields',
      '    1 3 fields',
      'others 1 item'
    ])
  })

  it('show a value as JSON, a long text cut', () => {
    const rows = treeRows({ s: 'hi', n: null, b: false, long: 'x'.repeat(200) }, new Set(), [])
    expect(rows.map(row => row.summary)).toEqual(['"hi"', 'null', 'false', `"${'x'.repeat(80)}…"`])
    expect(rows.every(row => row.kind === 'value')).toBe(true)
  })

  it('open a folded node by its id, and tell keys that look alike apart', () => {
    const json = { 'a.b': { c: 1 }, 'a': { b: { c: 2 } } }
    const rows = treeRows(json, new Set([rowId(['a.b'])]), [])
    expect(rows.map(row => `${row.depth}:${row.key}`)).toEqual(['0:a.b', '1:c', '0:a'])
  })

  it('show at most 50 entries of a container, then how many more there are', () => {
    const json = { list: Array.from({ length: 60 }, (_, at) => at) }
    const rows = treeRows(json, new Set([rowId(['list'])]), [])
    expect(rows).toHaveLength(1 + 50 + 1)
    expect(rows.at(-1)).toMatchObject({ kind: 'more', summary: '10 more', depth: 1 })
  })

  it('is one value row for an answer that is not an object nor a list', () => {
    expect(treeRows(42, new Set(), [])).toEqual([{ id: rowId([]), key: 'answer', depth: 0, kind: 'value', summary: '42' }])
  })
})
