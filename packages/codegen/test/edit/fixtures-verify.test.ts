// D4 (S4) verifier regressions: sample-data edits keep every row a full row of its entity (the generated seed is typed
// `Post[]`), number bounds and ambiguous row keys are refused, and a refused edit writes nothing.
import { describe, expect, it } from 'vitest'
import { applyEdit } from '../../src/edit/index'
import { generate } from '../../src/generate/index'
import { project } from './helpers'
import type { Json } from './helpers'

const POSTS = '.bildr/modules/blog/fixtures/post.json'
const FIRST = '0b6f6a52-1c7a-4c1e-9a52-7a0e2f3d9a01'
const SECOND = '0b6f6a52-1c7a-4c1e-9a52-7a0e2f3d9a02'

const rows = (p: ReturnType<typeof project>, path = POSTS) => p.json(path).rows as Json[]

describe('emptying a field that has a default', () => {
  // The grid sends null when an optional text cell is cleared (`cellValue`). Post.body has `default: ""`, so the generated
  // `Post` type requires it: a seed row without `body` fails the generated app's typecheck (TS2741).
  for (const [field, fallback] of [['body', ''], ['published', false]] as const) {
    it(`keeps ${field} in the row (its default) or refuses the null, never drops the key`, () => {
      const p = project()
      const before = p.files[POSTS]
      const outcome = applyEdit(p.files, 'fixture_row_update', { entity: 'ent_post', row: FIRST, values: { [field]: null } })
      if (!outcome.ok) {
        expect(outcome.code).toBe('invalid')
        expect(p.files[POSTS]).toBe(before)
        return
      }
      const after = JSON.parse(outcome.changes.find(change => change.path === POSTS)!.content!) as { rows: Json[] }
      expect(after.rows[0]).toHaveProperty(field, fallback)
    })
  }

  it('fixture_row_create given null for a defaulted field stores the default', () => {
    const p = project()
    const outcome = applyEdit(p.files, 'fixture_row_create', { entity: 'ent_post', values: { title: 'T', slug: 't', body: null } })
    if (!outcome.ok) return expect(outcome.code).toBe('invalid')
    const after = JSON.parse(outcome.changes.find(change => change.path === POSTS)!.content!) as { rows: Json[] }
    expect(after.rows[2]).toHaveProperty('body', '')
  })
})

describe('number bounds', () => {
  it('refuses a number above max and below min, and accepts both edges', () => {
    const p = project()
    p.edit('entity_create', { name: 'tag', source: 'ds_main', fields: [{ name: 'weight', type: 'number', required: true }] })
    const tag = p.json('.bildr/modules/blog/entities/tag.json')
    Object.assign(tag.fields[0], { min: -1.5, max: 1.5 })
    const bounded = project({ ...p.files, '.bildr/modules/blog/entities/tag.json': JSON.stringify(tag) })
    const id = bounded.edit('fixture_row_create', { entity: 'ent_tag' }).rowId as string
    const path = '.bildr/modules/blog/fixtures/tag.json'
    const before = bounded.files[path]
    expect(bounded.refuse('fixture_row_update', { entity: 'ent_tag', row: id, values: { weight: 1.51 } }, 'invalid').message).toBe('weight must be at most 1.5')
    expect(bounded.refuse('fixture_row_update', { entity: 'ent_tag', row: id, values: { weight: -1.6 } }, 'invalid').message).toBe('weight must be at least -1.5')
    expect(bounded.files[path]).toBe(before)
    bounded.edit('fixture_row_update', { entity: 'ent_tag', row: id, values: { weight: 1.5 } })
    bounded.edit('fixture_row_update', { entity: 'ent_tag', row: id, values: { weight: -1.5 } })
  })
})

describe('row keys', () => {
  const withItems = (itemRows: Json[]) => {
    const p = project()
    const entity = { id: 'ent_item', name: 'Item', plural: 'items', idStrategy: 'external', timestamps: false, fields: [{ id: 'fld_i_id', name: 'id', type: 'integer', required: true }, { id: 'fld_i_label', name: 'label', type: 'text', required: true }], relations: [], client: { sync: 'eager' } }
    const repository = { id: 'repo_item', entity: 'ent_item', datasource: 'ds_main', table: 'blog_items', operations: ['list', 'get'], expose: { list: true } }
    return project({
      ...p.files,
      '.bildr/modules/blog/entities/item.json': JSON.stringify(entity),
      '.bildr/modules/blog/repositories/item.json': JSON.stringify(repository),
      '.bildr/modules/blog/fixtures/item.json': JSON.stringify({ entity: 'ent_item', rows: itemRows })
    })
  }

  it('refuses a key that is both a row\'s id and an id-less row\'s position, for update and delete, and writes nothing', () => {
    const p = withItems([{ id: 1, label: 'one' }, { label: 'no id' }])
    const before = p.files['.bildr/modules/blog/fixtures/item.json']
    p.refuse('fixture_row_update', { entity: 'ent_item', row: '1', values: { label: 'x' } }, 'invalid')
    p.refuse('fixture_rows_delete', { entity: 'ent_item', rows: ['1'] }, 'invalid')
    expect(p.files['.bildr/modules/blog/fixtures/item.json']).toBe(before)
  })

  it('a bulk delete by positions removes the rows those positions named before the delete', () => {
    const p = withItems([{ id: 7, label: 'seven' }, { label: 'A' }, { label: 'B' }, { label: 'C' }])
    p.edit('fixture_rows_delete', { entity: 'ent_item', rows: ['1', '3'] })
    expect(rows(p, '.bildr/modules/blog/fixtures/item.json').map(row => row.label)).toEqual(['seven', 'B'])
  })
})

describe('deleting every sample row', () => {
  // publishPost's generated test reads postSeed[0]!.id: with no rows it throws "Cannot read properties of undefined".
  it('is refused, or the generated test no longer indexes an empty seed', () => {
    const p = project()
    const outcome = applyEdit(p.files, 'fixture_rows_delete', { entity: 'ent_post', rows: [FIRST, SECOND] })
    if (!outcome.ok) return expect(outcome.code).toBe('invalid')
    const after = project({ ...p.files, [POSTS]: outcome.changes.find(change => change.path === POSTS)!.content! })
    const test = generate(after.model()).find(file => file.path === 'layers/blog/test/application/publish-post.test.ts')!
    expect(test.content).not.toContain('postSeed[0]!.id')
  })
})
