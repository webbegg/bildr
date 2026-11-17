// D4 (S4): the sample-data rows of an entity (its fixtures file) as module edits: validated against the entity's fields, written only under `.bildr/`.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fixtureSource } from '../../src/edit/fixtures'
import { generate } from '../../src/generate/index'
import { loadModel } from '../../src/model/load'
import { fixtureModelFiles } from '../model/fixture'
import { project } from './helpers'
import type { Json } from './helpers'

const POSTS = '.bildr/modules/blog/fixtures/post.json'
const FIRST = '0b6f6a52-1c7a-4c1e-9a52-7a0e2f3d9a01'
const SECOND = '0b6f6a52-1c7a-4c1e-9a52-7a0e2f3d9a02'
const NEW_ID = '11111111-2222-4333-8444-555555555555'
const NOW = '2026-11-17T10:00:00.000Z'

const real = { ...fixtureSource }
beforeEach(() => {
  fixtureSource.newId = () => NEW_ID
  fixtureSource.now = () => NOW
})
afterEach(() => Object.assign(fixtureSource, real))

const rows = (p: ReturnType<typeof project>, path = POSTS) => p.json(path).rows as Json[]
const paths = (changes: Array<{ path: string }>) => changes.map(change => change.path)

describe('fixture_row_create', () => {
  it('adds a row with the id minted, the defaults and the timestamps filled, and writes only the fixtures file', () => {
    const p = project()
    const made = p.edit('fixture_row_create', { entity: 'ent_post', values: { title: 'Second thoughts', slug: 'second-thoughts', published: true } })
    expect(made.rowId).toBe(NEW_ID)
    expect(paths(made.changes)).toEqual([POSTS])
    expect(rows(p)).toHaveLength(3)
    expect(rows(p)[2]).toEqual({
      id: NEW_ID, title: 'Second thoughts', slug: 'second-thoughts', body: '', published: true, publishedAt: null, createdAt: NOW, updatedAt: NOW
    })
    // The model stays valid and still generates.
    expect(() => generate(p.model())).not.toThrow()
  })

  it('takes an id the caller gives (a uuid nobody has) and refuses a duplicate', () => {
    const p = project()
    expect(p.edit('fixture_row_create', { entity: 'ent_post', values: { id: '22222222-2222-4222-8222-222222222222', title: 'A', slug: 'a' } }).rowId).toBe('22222222-2222-4222-8222-222222222222')
    expect(p.refuse('fixture_row_create', { entity: 'ent_post', values: { id: FIRST, title: 'B', slug: 'b' } }, 'invalid').message).toContain('already has a row')
    expect(p.refuse('fixture_row_create', { entity: 'ent_post', values: { id: 'not-a-uuid', title: 'B', slug: 'b' } }, 'invalid').message).toContain('uuid')
  })

  it('fills a required field it was not given with the empty value of its type, to be filled in', () => {
    const p = project()
    p.edit('fixture_row_create', { entity: 'ent_post' })
    expect(rows(p)[2]).toEqual({ id: NEW_ID, title: '', slug: '', body: '', published: false, publishedAt: null, createdAt: NOW, updatedAt: NOW })
    p.edit('entity_create', { name: 'tag', source: 'ds_main', fields: [{ name: 'weight', type: 'integer', required: true }, { name: 'day', type: 'date', required: true }, { name: 'at', type: 'datetime', required: true }, { name: 'ref', type: 'uuid', required: true }] })
    p.edit('fixture_row_create', { entity: 'ent_tag' })
    expect(rows(p, '.bildr/modules/blog/fixtures/tag.json')[0]).toEqual({ id: NEW_ID, weight: 0, day: '2026-11-17', at: NOW, ref: NEW_ID })
  })

  it('stays within the bounds of a number it has to fill', () => {
    const p = project()
    p.edit('entity_create', { name: 'tag', source: 'ds_main', fields: [{ name: 'weight', type: 'integer', required: true }] })
    const tag = p.json('.bildr/modules/blog/entities/tag.json')
    tag.fields[0].min = 5
    const files = { ...p.files, '.bildr/modules/blog/entities/tag.json': JSON.stringify(tag) }
    const bounded = project(files)
    bounded.edit('fixture_row_create', { entity: 'ent_tag' })
    expect(rows(bounded, '.bildr/modules/blog/fixtures/tag.json')[0]).toMatchObject({ weight: 5 })
  })

  it('refuses to empty a required field in the values it is given', () => {
    const p = project()
    expect(p.refuse('fixture_row_create', { entity: 'ent_post', values: { title: null, slug: 'x' } }, 'invalid').message).toContain('title is required')
    expect(rows(p)).toHaveLength(2)
  })

  it('refuses a value of the wrong type, an unknown field and a read-only field', () => {
    const p = project()
    expect(p.refuse('fixture_row_create', { entity: 'ent_post', values: { title: 'A', slug: 'a', published: 'yes' } }, 'invalid').message).toContain('published must be true or false')
    expect(p.refuse('fixture_row_create', { entity: 'ent_post', values: { title: 'A', slug: 'a', nope: 1 } }, 'invalid').message).toContain('Entity Post has no field "nope"')
    expect(p.refuse('fixture_row_create', { entity: 'ent_post', values: { title: 'A', slug: 'a', publishedAt: '2026-01-01T00:00:00Z' } }, 'invalid').message).toContain('publishedAt is read-only')
    expect(p.refuse('fixture_row_create', { entity: 'ent_post', values: { title: 'A', slug: 'a', createdAt: NOW } }, 'invalid').message).toContain('createdAt is read-only')
  })

  it('checks the bounds and the pattern of a field', () => {
    const p = project()
    expect(p.refuse('fixture_row_create', { entity: 'ent_post', values: { title: '', slug: 'a' } }, 'invalid').message).toContain('title')
    expect(p.refuse('fixture_row_create', { entity: 'ent_post', values: { title: 'x'.repeat(121), slug: 'a' } }, 'invalid').message).toContain('120')
    expect(p.refuse('fixture_row_create', { entity: 'ent_post', values: { title: 'A', slug: 'Not Valid' } }, 'invalid').message).toContain('Use lowercase letters, numbers and dashes')
  })

  it('refuses an unknown entity, and a REST collection (it has no sample data)', () => {
    const p = project()
    expect(p.refuse('fixture_row_create', { entity: 'ent_nope' }, 'not_found').message).toContain('ent_nope')
    expect(p.refuse('fixture_row_create', { entity: 'ent_quote', values: {} }, 'invalid').message).toBe('A REST collection has no sample data')
  })

  it('creates the fixtures file when the entity has none, next to the entity\'s module', () => {
    const p = project()
    p.edit('entity_create', { name: 'tag', source: 'ds_main', fields: [{ name: 'label', type: 'text', required: true }, { name: 'weight', type: 'integer' }] })
    expect(p.files['.bildr/modules/blog/fixtures/tag.json']).toBeUndefined()
    const made = p.edit('fixture_row_create', { entity: 'ent_tag', values: { label: 'news' } })
    expect(made.fixturesPath).toBe('.bildr/modules/blog/fixtures/tag.json')
    expect(paths(made.changes)).toEqual(['.bildr/modules/blog/fixtures/tag.json'])
    expect(p.json('.bildr/modules/blog/fixtures/tag.json')).toMatchObject({ entity: 'ent_tag', rows: [{ id: NEW_ID, label: 'news' }] })
    // An optional field with no default and no value stays out of the row.
    expect(rows(p, '.bildr/modules/blog/fixtures/tag.json')[0]).not.toHaveProperty('weight')
    expect(() => generate(p.model())).not.toThrow()
  })

  it('fills a blank row when no values are given and nothing is required', () => {
    const p = project()
    p.edit('entity_create', { name: 'tag', source: 'ds_main', fields: [{ name: 'label', type: 'text' }] })
    p.edit('fixture_row_create', { entity: 'ent_tag' })
    expect(rows(p, '.bildr/modules/blog/fixtures/tag.json')).toEqual([{ id: NEW_ID }])
  })
})

describe('fixture_row_update', () => {
  it('changes the values it is given and leaves the rest of the row and the other rows alone', () => {
    const p = project()
    const before = rows(p)
    const done = p.edit('fixture_row_update', { entity: 'ent_post', row: FIRST, values: { title: 'Hello again', published: false } })
    expect(done.rowId).toBe(FIRST)
    expect(paths(done.changes)).toEqual([POSTS])
    expect(rows(p)[0]).toEqual({ ...before[0], title: 'Hello again', published: false })
    expect(rows(p)[1]).toEqual(before[1])
  })

  it('refuses a value of the wrong type, and writes nothing', () => {
    const p = project()
    const before = p.files[POSTS]
    expect(p.refuse('fixture_row_update', { entity: 'ent_post', row: FIRST, values: { published: 'yes' } }, 'invalid').message).toContain('published must be true or false')
    expect(p.refuse('fixture_row_update', { entity: 'ent_post', row: FIRST, values: { title: 5 } }, 'invalid').message).toContain('title must be text')
    expect(p.files[POSTS]).toBe(before)
  })

  it('refuses an unknown field, a read-only one and the id', () => {
    const p = project()
    expect(p.refuse('fixture_row_update', { entity: 'ent_post', row: FIRST, values: { nope: 'x' } }, 'invalid').message).toContain('Entity Post has no field "nope"')
    expect(p.refuse('fixture_row_update', { entity: 'ent_post', row: FIRST, values: { publishedAt: null } }, 'invalid').message).toContain('publishedAt is read-only')
    expect(p.refuse('fixture_row_update', { entity: 'ent_post', row: FIRST, values: { id: NEW_ID } }, 'invalid').message).toContain('id')
  })

  it('refuses to empty a required field, and an empty change', () => {
    const p = project()
    expect(p.refuse('fixture_row_update', { entity: 'ent_post', row: FIRST, values: { title: null } }, 'invalid').message).toContain('title is required')
    p.refuse('fixture_row_update', { entity: 'ent_post', row: FIRST, values: {} }, 'invalid_input')
  })

  it('removes a value an optional field may leave out, and sets null on a field that may be null', () => {
    const p = project()
    p.edit('entity_create', { name: 'tag', source: 'ds_main', fields: [{ name: 'label', type: 'text' }] })
    const id = p.edit('fixture_row_create', { entity: 'ent_tag', values: { label: 'news' } }).rowId
    p.edit('fixture_row_update', { entity: 'ent_tag', row: id, values: { label: null } })
    expect(rows(p, '.bildr/modules/blog/fixtures/tag.json')).toEqual([{ id: NEW_ID }])
  })

  it('refuses an unknown entity and an unknown row', () => {
    const p = project()
    expect(p.refuse('fixture_row_update', { entity: 'ent_nope', row: FIRST, values: { title: 'x' } }, 'not_found').message).toContain('ent_nope')
    expect(p.refuse('fixture_row_update', { entity: 'ent_post', row: 'missing', values: { title: 'x' } }, 'not_found').message).toContain('missing')
    expect(p.refuse('fixture_row_update', { entity: 'ent_quote', row: 'x', values: { text: 'x' } }, 'invalid').message).toBe('A REST collection has no sample data')
  })

  it('finds a row that has no id by its place among the rows, as the table does', () => {
    const files = fixtureModelFiles()
    const file = JSON.parse(files[POSTS]!) as { rows: Json[] }
    file.rows.push({ title: 'Anonymous', slug: 'anonymous' })
    const p = project({ ...files, [POSTS]: JSON.stringify(file) })
    expect(p.edit('fixture_row_update', { entity: 'ent_post', row: '2', values: { title: 'Named' } }).rowId).toBe('2')
    expect(rows(p)[2]).toMatchObject({ title: 'Named', slug: 'anonymous' })
  })
})

describe('fixture_rows_delete', () => {
  it('deletes one row, or several at once, and keeps the file when it empties', () => {
    const p = project()
    const made = p.edit('fixture_row_create', { entity: 'ent_post', values: { title: 'C', slug: 'c' } }).rowId
    expect(p.edit('fixture_rows_delete', { entity: 'ent_post', rows: [FIRST] }).deleted).toEqual([FIRST])
    expect(rows(p).map(row => row.id)).toEqual([SECOND, made])
    const done = p.edit('fixture_rows_delete', { entity: 'ent_post', rows: [SECOND, made] })
    expect(done.deleted).toEqual([SECOND, made])
    expect(paths(done.changes)).toEqual([POSTS])
    // The file stays (the generated tests of an action that loads rows need it), with no rows.
    expect(p.json(POSTS)).toMatchObject({ entity: 'ent_post', rows: [] })
    expect(() => generate(p.model())).not.toThrow()
  })

  it('is all or nothing: one unknown row refuses the whole delete', () => {
    const p = project()
    const before = p.files[POSTS]
    expect(p.refuse('fixture_rows_delete', { entity: 'ent_post', rows: [FIRST, 'missing'] }, 'not_found').message).toContain('missing')
    expect(p.files[POSTS]).toBe(before)
  })

  it('refuses an unknown entity, a REST collection and an empty list', () => {
    const p = project()
    p.refuse('fixture_rows_delete', { entity: 'ent_nope', rows: [FIRST] }, 'not_found')
    expect(p.refuse('fixture_rows_delete', { entity: 'ent_quote', rows: ['1'] }, 'invalid').message).toBe('A REST collection has no sample data')
    p.refuse('fixture_rows_delete', { entity: 'ent_post', rows: [] }, 'invalid_input')
  })

  it('counts a row named twice once', () => {
    const p = project()
    expect(p.edit('fixture_rows_delete', { entity: 'ent_post', rows: [FIRST, FIRST] }).deleted).toEqual([FIRST])
  })
})

describe('the model after sample-data edits', () => {
  it('loads and generates after a create, an update and a delete in turn', () => {
    const p = project()
    const id = p.edit('fixture_row_create', { entity: 'ent_post', values: { title: 'A', slug: 'a' } }).rowId
    p.edit('fixture_row_update', { entity: 'ent_post', row: id, values: { body: 'Text' } })
    p.edit('fixture_rows_delete', { entity: 'ent_post', rows: [FIRST] })
    expect(loadModel(p.files).ok).toBe(true)
    expect(() => generate(p.model())).not.toThrow()
    expect(Object.keys(p.files).filter(path => !path.startsWith('.bildr/'))).toEqual([])
  })

  it('leaves the entity, its fields and every other file as they were', () => {
    const p = project()
    const before = { ...p.files }
    p.edit('fixture_row_create', { entity: 'ent_post', values: { title: 'A', slug: 'a' } })
    for (const path of Object.keys(before)) if (path !== POSTS) expect(p.files[path], path).toBe(before[path])
  })
})
