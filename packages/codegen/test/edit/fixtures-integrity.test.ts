// D4 (S4) follow-ups: a sample row always holds every key the generated seed type (`Post[]`, from `z.infer`) requires, unique
// fields stay unique, values are checked as strictly as the app's own zod schemas, a stale row key is a conflict, and the
// last row an action's generated test uses can't be deleted.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fixtureSource } from '../../src/edit/fixtures'
import { generate } from '../../src/generate/index'
import { project } from './helpers'
import type { Json } from './helpers'

const POSTS = '.bildr/modules/blog/fixtures/post.json'
const FIRST = '0b6f6a52-1c7a-4c1e-9a52-7a0e2f3d9a01'
const SECOND = '0b6f6a52-1c7a-4c1e-9a52-7a0e2f3d9a02'
const NOW = '2026-11-17T10:00:00.000Z'

const real = { ...fixtureSource }
let counter = 0
beforeEach(() => {
  counter = 0
  fixtureSource.newId = () => `11111111-2222-4333-8444-${String(++counter).padStart(12, '0')}`
  fixtureSource.now = () => NOW
})
afterEach(() => Object.assign(fixtureSource, real))

const rows = (p: ReturnType<typeof project>, path = POSTS) => p.json(path).rows as Json[]

/** The keys the generated type of an entity requires of a row, read from the entity file the way `zodField` decides it. */
const requiredKeys = (entity: Json): string[] => [
  ...(entity.idStrategy === 'uuid' ? ['id'] : []),
  ...(entity.fields as Json[]).filter(field => field.default !== undefined || field.nullable || field.required).map(field => field.name as string),
  ...(entity.timestamps ? ['createdAt', 'updatedAt'] : [])
]

describe('no edit leaves a row without a key its generated type requires', () => {
  const FIELDS = [
    { name: 'label', type: 'text', required: true },
    { name: 'note', type: 'text', default: 'none' },
    { name: 'count', type: 'integer', default: 3 },
    { name: 'flag', type: 'boolean', default: true },
    { name: 'when', type: 'date', default: '2026-01-01' },
    { name: 'maybe', type: 'text', nullable: true },
    { name: 'maybeDefault', type: 'text', nullable: true, default: 'x' },
    { name: 'plain', type: 'text' }
  ]
  const make = () => {
    const p = project()
    p.edit('entity_create', { name: 'tag', source: 'ds_main', fields: FIELDS.map(({ name, type, required }) => ({ name, type, required })) })
    const path = '.bildr/modules/blog/entities/tag.json'
    const entity = p.json(path)
    // The default and nullable of a field are written in the file: the entity edits don't take them.
    for (const field of entity.fields as Json[]) {
      const { default: fallback, nullable } = FIELDS.find(entry => entry.name === field.name) as Json
      if (fallback !== undefined) field.default = fallback
      if (nullable) field.nullable = true
    }
    return project({ ...p.files, [path]: JSON.stringify(entity) })
  }
  const TAGS = '.bildr/modules/blog/fixtures/tag.json'
  const complete = (p: ReturnType<typeof project>) => {
    const keys = requiredKeys(p.json('.bildr/modules/blog/entities/tag.json'))
    for (const row of rows(p, TAGS)) for (const key of keys) expect(row, `${key} of ${JSON.stringify(row)}`).toHaveProperty(key)
  }

  it('on a create, whatever the values (null included) and whatever they leave out', () => {
    const p = make()
    p.edit('fixture_row_create', { entity: 'ent_tag' })
    p.edit('fixture_row_create', { entity: 'ent_tag', values: { label: 'a', note: null, count: null, flag: null, when: null, maybe: null, maybeDefault: null, plain: null } })
    expect(rows(p, TAGS)[1]).toMatchObject({ note: 'none', count: 3, flag: true, when: '2026-01-01', maybe: null, maybeDefault: null })
    expect(rows(p, TAGS)[1]).not.toHaveProperty('plain')
    complete(p)
  })

  it('on an update that empties a field with a default: it stores the default', () => {
    const p = make()
    const id = p.edit('fixture_row_create', { entity: 'ent_tag', values: { label: 'a', note: 'changed', count: 9, flag: false, when: '2026-05-05' } }).rowId as string
    p.edit('fixture_row_update', { entity: 'ent_tag', row: id, values: { note: null, count: null, flag: null, when: null } })
    expect(rows(p, TAGS)[0]).toMatchObject({ note: 'none', count: 3, flag: true, when: '2026-01-01' })
    complete(p)
  })

  it('on an update that empties a field that can be null: it stores null; an optional one with no default leaves the key out', () => {
    const p = make()
    const id = p.edit('fixture_row_create', { entity: 'ent_tag', values: { label: 'a', maybe: 'm', plain: 'p' } }).rowId as string
    p.edit('fixture_row_update', { entity: 'ent_tag', row: id, values: { maybe: null, maybeDefault: null, plain: null } })
    expect(rows(p, TAGS)[0]).toMatchObject({ maybe: null, maybeDefault: null })
    expect(rows(p, TAGS)[0]).not.toHaveProperty('plain')
    complete(p)
  })

  it('a required field that has a default takes the default when it is emptied', () => {
    const p = project()
    p.edit('entity_create', { name: 'tag', source: 'ds_main', fields: [{ name: 'label', type: 'text', required: true }] })
    const path = '.bildr/modules/blog/entities/tag.json'
    const entity = p.json(path)
    entity.fields[0].default = 'untitled label'
    const withDefault = project({ ...p.files, [path]: JSON.stringify(entity) })
    const id = withDefault.edit('fixture_row_create', { entity: 'ent_tag', values: { label: 'a' } }).rowId as string
    withDefault.edit('fixture_row_update', { entity: 'ent_tag', row: id, values: { label: null } })
    expect(rows(withDefault, TAGS)[0]).toMatchObject({ label: 'untitled label' })
  })

  it('the timestamps of the entity are stamped on a create and never dropped by an update', () => {
    const p = project()
    const id = p.edit('fixture_row_create', { entity: 'ent_post', values: { title: 'T', slug: 't', body: null } }).rowId as string
    p.edit('fixture_row_update', { entity: 'ent_post', row: id, values: { body: null, published: null } })
    expect(rows(p)[2]).toMatchObject({ body: '', published: false, createdAt: NOW, updatedAt: NOW })
    for (const row of rows(p)) for (const key of requiredKeys(p.json('.bildr/modules/blog/entities/post.json'))) expect(row, key).toHaveProperty(key)
  })

  it('the model with the edited rows still generates its seed', () => {
    const p = make()
    const id = p.edit('fixture_row_create', { entity: 'ent_tag', values: { label: 'a' } }).rowId as string
    p.edit('fixture_row_update', { entity: 'ent_tag', row: id, values: { note: null } })
    const seed = generate(p.model()).find(file => file.path.endsWith('/db/seed.ts'))!
    expect(seed.content).toContain('note: \'none\'')
  })
})

describe('unique fields', () => {
  it('an update to a value another row has is refused, and writes nothing', () => {
    const p = project()
    const before = p.files[POSTS]
    expect(p.refuse('fixture_row_update', { entity: 'ent_post', row: SECOND, values: { slug: 'hello-bildr' } }, 'invalid').message).toBe('slug must be unique: another sample row already has "hello-bildr"')
    expect(p.files[POSTS]).toBe(before)
  })

  it('an update that keeps the row\'s own value is fine', () => {
    const p = project()
    p.edit('fixture_row_update', { entity: 'ent_post', row: FIRST, values: { slug: 'hello-bildr', title: 'Same slug' } })
  })

  it('a create with a value another row has is refused', () => {
    const p = project()
    expect(p.refuse('fixture_row_create', { entity: 'ent_post', values: { title: 'T', slug: 'a-draft' } }, 'invalid').message).toBe('slug must be unique: another sample row already has "a-draft"')
    expect(rows(p)).toHaveLength(2)
  })

  it('the placeholder of a unique text field is unique too: empty first, then untitled, untitled-2', () => {
    const p = project()
    p.edit('fixture_row_create', { entity: 'ent_post' })
    p.edit('fixture_row_create', { entity: 'ent_post' })
    p.edit('fixture_row_create', { entity: 'ent_post' })
    expect(rows(p).slice(2).map(row => row.slug)).toEqual(['', 'untitled', 'untitled-2'])
  })

  it('the placeholder of a unique number is the next one free', () => {
    const p = project()
    p.edit('entity_create', { name: 'tag', source: 'ds_main', fields: [{ name: 'rank', type: 'integer', required: true }] })
    const path = '.bildr/modules/blog/entities/tag.json'
    const entity = p.json(path)
    entity.fields[0].unique = true
    const unique = project({ ...p.files, [path]: JSON.stringify(entity) })
    unique.edit('fixture_row_create', { entity: 'ent_tag' })
    unique.edit('fixture_row_create', { entity: 'ent_tag' })
    expect(rows(unique, '.bildr/modules/blog/fixtures/tag.json').map(row => row.rank)).toEqual([0, 1])
  })
})

describe('values are checked as the generated app checks them', () => {
  const make = () => {
    const p = project()
    p.edit('entity_create', { name: 'tag', source: 'ds_main', fields: [{ name: 'day', type: 'date' }, { name: 'at', type: 'datetime' }, { name: 'ref', type: 'uuid' }] })
    const id = p.edit('fixture_row_create', { entity: 'ent_tag' }).rowId as string
    return { p, id }
  }

  it.each([
    ['day', '2026-13-45', 'a date like 2026-01-15'],
    ['day', '2026-02-30', 'a date like 2026-01-15'],
    ['at', '2026-02-30T09:30:00Z', 'a date and time like 2026-01-15T09:30:00Z'],
    ['at', '2026-02-03T09:30:00+02:00', 'a date and time like 2026-01-15T09:30:00Z'],
    ['at', '2026-02-03T09:30:00', 'a date and time like 2026-01-15T09:30:00Z'],
    ['ref', '0b6f6a52-1c7a-0c1e-9a52-7a0e2f3d9a01', 'a uuid'],
    ['ref', 'not-a-uuid', 'a uuid']
  ])('refuses %s = %s', (field, value, label) => {
    const { p, id } = make()
    expect(p.refuse('fixture_row_update', { entity: 'ent_tag', row: id, values: { [field]: value } }, 'invalid').message).toBe(`${field} must be ${label}`)
  })

  it.each([
    ['day', '2026-02-28'],
    ['at', '2026-02-03T09:30:00Z'],
    ['at', '2026-02-03T09:30:00.123Z'],
    ['ref', '00000000-0000-4000-8000-000000000001']
  ])('accepts %s = %s', (field, value) => {
    const { p, id } = make()
    p.edit('fixture_row_update', { entity: 'ent_tag', row: id, values: { [field]: value } })
  })

  it('a new row\'s own id has to be a uuid the app accepts', () => {
    const p = project()
    p.refuse('fixture_row_create', { entity: 'ent_post', values: { id: '0b6f6a52-1c7a-0c1e-9a52-7a0e2f3d9a09', title: 'A', slug: 'a' } }, 'invalid')
  })
})

describe('a key that no longer names the row the client saw', () => {
  const withNoIds = () => {
    const p = project()
    const entity = { id: 'ent_item', name: 'Item', plural: 'items', idStrategy: 'external', timestamps: false, fields: [{ id: 'fld_i_id', name: 'id', type: 'integer', required: true }, { id: 'fld_i_label', name: 'label', type: 'text', required: true }], relations: [], client: { sync: 'eager' } }
    const repository = { id: 'repo_item', entity: 'ent_item', datasource: 'ds_main', table: 'blog_items', operations: ['list', 'get'], expose: { list: true } }
    return project({
      ...p.files,
      '.bildr/modules/blog/entities/item.json': JSON.stringify(entity),
      '.bildr/modules/blog/repositories/item.json': JSON.stringify(repository),
      '.bildr/modules/blog/fixtures/item.json': JSON.stringify({ entity: 'ent_item', rows: [{ id: 7, label: 'seven' }, { label: 'A' }, { label: 'B' }] })
    })
  }
  const ITEMS = '.bildr/modules/blog/fixtures/item.json'

  it('an update whose base differs from the row at that key is a conflict, and writes nothing', () => {
    const p = withNoIds()
    p.edit('fixture_rows_delete', { entity: 'ent_item', rows: ['1'] })
    const before = p.files[ITEMS]
    // "1" now names B, not the A the client still shows.
    const refusal = p.refuse('fixture_row_update', { entity: 'ent_item', row: '1', base: { label: 'A' }, values: { label: 'edited' } }, 'conflict')
    expect(refusal.message).toContain('"1"')
    expect(refusal.message).toContain('changed')
    expect(p.files[ITEMS]).toBe(before)
  })

  it('an update whose base is the row goes through, whatever the order of its keys', () => {
    const p = project()
    p.edit('fixture_row_update', { entity: 'ent_post', row: SECOND, base: { ...rows(p)[1], title: 'A draft' }, values: { title: 'Edited' } })
    expect(rows(p)[1]).toMatchObject({ title: 'Edited' })
  })

  it('an update with no base works as before', () => {
    const p = withNoIds()
    p.edit('fixture_row_update', { entity: 'ent_item', row: '2', values: { label: 'edited' } })
  })

  it('a delete whose base differs for any row is a conflict that deletes nothing', () => {
    const p = withNoIds()
    p.edit('fixture_rows_delete', { entity: 'ent_item', rows: ['1'] })
    const before = p.files[ITEMS]
    // The rows are now seven (key "7") and B (key "1"): the client still shows A at "1".
    p.refuse('fixture_rows_delete', { entity: 'ent_item', rows: ['7', '1'], base: { 7: { id: 7, label: 'seven' }, 1: { label: 'A' } } }, 'conflict')
    expect(p.files[ITEMS]).toBe(before)
    p.edit('fixture_rows_delete', { entity: 'ent_item', rows: ['7', '1'], base: { 7: { id: 7, label: 'seven' }, 1: { label: 'B' } } })
    expect(rows(p, ITEMS)).toEqual([])
  })

  it('a base for a row that is no longer there is the not-found, not a conflict', () => {
    const p = withNoIds()
    p.refuse('fixture_row_update', { entity: 'ent_item', row: '9', base: { label: 'A' }, values: { label: 'x' } }, 'not_found')
  })

  it('an ambiguous key says what is ambiguous', () => {
    const p = project()
    const duplicated = JSON.parse(p.files[POSTS]!) as { rows: Json[] }
    duplicated.rows.push({ ...duplicated.rows[0] })
    const twice = project({ ...p.files, [POSTS]: JSON.stringify(duplicated) })
    expect(twice.refuse('fixture_row_update', { entity: 'ent_post', row: FIRST, values: { title: 'x' } }, 'invalid').message).toContain(`2 sample rows with the id "${FIRST}"`)

    const mixed = withNoIds()
    const file = JSON.parse(mixed.files[ITEMS]!) as { rows: Json[] }
    file.rows = [{ id: 1, label: 'one' }, { label: 'no id' }]
    const ambiguous = project({ ...mixed.files, [ITEMS]: JSON.stringify(file) })
    const message = ambiguous.refuse('fixture_row_update', { entity: 'ent_item', row: '1', values: { label: 'x' } }, 'invalid').message
    expect(message).toContain('"1"')
    expect(message).toContain('the id of one row and the place of another')
    expect(message).not.toContain('with the id "1"')
  })
})

describe('deleting the last sample row', () => {
  it('is refused while an action\'s generated test loads a row of the entity', () => {
    const p = project()
    p.edit('fixture_rows_delete', { entity: 'ent_post', rows: [FIRST] })
    const before = p.files[POSTS]
    expect(p.refuse('fixture_rows_delete', { entity: 'ent_post', rows: [SECOND] }, 'invalid').message).toBe('Keep at least one sample row: publishPost tests use it')
    expect(p.files[POSTS]).toBe(before)
  })

  it('refuses the delete of every row at once, as one bulk delete', () => {
    const p = project()
    expect(p.refuse('fixture_rows_delete', { entity: 'ent_post', rows: [FIRST, SECOND] }, 'invalid').message).toBe('Keep at least one sample row: publishPost tests use it')
  })

  it('leaves an entity no action loads free to empty', () => {
    const p = project()
    p.edit('entity_create', { name: 'tag', source: 'ds_main', fields: [{ name: 'label', type: 'text' }] })
    const id = p.edit('fixture_row_create', { entity: 'ent_tag' }).rowId as string
    p.edit('fixture_rows_delete', { entity: 'ent_tag', rows: [id] })
    expect(rows(p, '.bildr/modules/blog/fixtures/tag.json')).toEqual([])
    expect(() => generate(p.model())).not.toThrow()
  })

  it('the rows that stay still generate a test that runs on a row', () => {
    const p = project()
    p.edit('fixture_rows_delete', { entity: 'ent_post', rows: [SECOND] })
    const test = generate(p.model()).find(file => file.path === 'layers/blog/test/application/publish-post.test.ts')!
    expect(test.content).toContain('postSeed[0]!.id')
    expect(rows(p)).toHaveLength(1)
  })
})

describe('what is said of the id of an entity whose source owns it', () => {
  const make = () => {
    const p = project()
    const entity = { id: 'ent_item', name: 'Item', plural: 'items', idStrategy: 'external', timestamps: false, fields: [{ id: 'fld_i_id', name: 'id', type: 'integer', required: true }, { id: 'fld_i_label', name: 'label', type: 'text', required: true }], relations: [], client: { sync: 'eager' } }
    const repository = { id: 'repo_item', entity: 'ent_item', datasource: 'ds_main', table: 'blog_items', operations: ['list', 'get'], expose: { list: true } }
    return project({
      ...p.files,
      '.bildr/modules/blog/entities/item.json': JSON.stringify(entity),
      '.bildr/modules/blog/repositories/item.json': JSON.stringify(repository),
      '.bildr/modules/blog/fixtures/item.json': JSON.stringify({ entity: 'ent_item', rows: [{ id: 1, label: 'a' }] })
    })
  }
  const create = (values: Json) => make().refuse('fixture_row_create', { entity: 'ent_item', values }, 'invalid').message

  it('says each thing once', () => {
    expect(create({ label: 'x' })).toBe('id is required: it is the key rows are found by')
    expect(create({ label: 'x', id: null })).toBe('id is required')
    expect(create({ label: 'x', id: 'x' })).toBe('id must be a whole number')
    expect(create({ label: 'x', id: 1 })).toBe('Item already has a row with the id "1"')
  })
})
