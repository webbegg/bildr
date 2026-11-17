// P3c: data actions over the .bildr model: data sources, entities (with their repository, queries,
// create action and fixtures) and fields. Same contract as P3a: a change set, the model still generating.
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { starterKit } from '../../src/starter/index'
import { project } from './helpers'

const apiOnlyRoot = fileURLToPath(new URL('../../../../fixtures/codegen/api-only', import.meta.url))
const golden = (path: string) => readFileSync(join(apiOnlyRoot, path), 'utf8')
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)])

/** An API-only project (no database): the starter plus the api-only fixture's REST files (Task), without its memory Note. */
const apiOnly = () => {
  const added = Object.fromEntries(walk(join(apiOnlyRoot, '.bildr'))
    .map(path => relative(apiOnlyRoot, path))
    .filter(path => !/datasources\/local|note/.test(path))
    .map(path => [path, golden(path)]))
  return project({ ...starterKit({ name: 'Tasks', database: 'none' }).model, ...added })
}

const NOTE_FILES = [
  '.bildr/datasources/local.json',
  '.bildr/modules/main/actions/create-note.json',
  '.bildr/modules/main/entities/note.json',
  '.bildr/modules/main/queries/note-by-id.json',
  '.bildr/modules/main/queries/notes.json',
  '.bildr/modules/main/repositories/note.json'
]

describe('a memory entity, from scratch', () => {
  it('datasource_create then entity_create write exactly the golden memory files (fixtures start empty)', () => {
    const p = apiOnly()
    const source = p.edit('datasource_create', { name: 'local', kind: 'memory' })
    expect(source).toMatchObject({ datasourceId: 'ds_local', filePath: '.bildr/datasources/local.json', database: false })
    const made = p.edit('entity_create', { name: 'note', source: 'ds_local', fields: [{ name: 'text', type: 'text', required: true }, { name: 'pinned', type: 'boolean' }] })
    expect(made).toMatchObject({
      entityId: 'ent_note',
      repositoryId: 'repo_note',
      queryIds: ['q_notes', 'q_note_by_id'],
      actionId: 'act_create_note',
      fixturesPath: '.bildr/modules/main/fixtures/note.json'
    })
    expect(made.changes.map((change: { path: string }) => change.path)).toEqual([...NOTE_FILES.slice(1), '.bildr/modules/main/fixtures/note.json'].sort())
    for (const path of NOTE_FILES) expect(p.files[path], path).toBe(golden(path))
    expect(p.json('.bildr/modules/main/fixtures/note.json')).toEqual({ entity: 'ent_note', rows: [] })
  })

  it('entity_delete takes its repository, queries, create action and fixtures along', () => {
    const p = apiOnly()
    p.edit('datasource_create', { name: 'local', kind: 'memory' })
    p.edit('entity_create', { name: 'note', source: 'ds_local', fields: [{ name: 'text', type: 'text' }] })
    const deleted = p.edit('entity_delete', { entity: 'ent_note' })
    expect(deleted.deleted).toEqual(['act_create_note', 'ent_note', 'q_note_by_id', 'q_notes', 'repo_note'])
    expect(deleted.changes).toEqual([...NOTE_FILES.slice(1), '.bildr/modules/main/fixtures/note.json'].sort().map(path => ({ path, content: null })))
    // Nothing uses the source any more: it can go too.
    expect(p.edit('datasource_delete', { datasource: 'ds_local' })).toMatchObject({ database: false })
  })
})

describe('entities over the other kinds of data source', () => {
  it('sqlite: every operation, in the app database, generating', () => {
    const p = project()
    const made = p.edit('entity_create', { name: 'blog tag', source: 'ds_main', fields: [{ name: 'label', type: 'text', required: true }] })
    expect(made).toMatchObject({ entityId: 'ent_blog_tag', repositoryId: 'repo_blog_tag', queryIds: ['q_blog_tags', 'q_blog_tag_by_id'], actionId: 'act_create_blog_tag' })
    expect(made.fixturesPath).toBeUndefined()
    expect(p.json('.bildr/modules/blog/entities/blog-tag.json')).toMatchObject({ name: 'BlogTag', plural: 'blogTags', idStrategy: 'uuid' })
    expect(p.json('.bildr/modules/blog/repositories/blog-tag.json')).toEqual({ id: 'repo_blog_tag', entity: 'ent_blog_tag', datasource: 'ds_main', operations: ['list', 'get', 'create', 'update', 'delete'], expose: { list: true } })
    expect(p.json('.bildr/modules/blog/queries/blog-tags.json')).toMatchObject({ label: 'All blog tags', result: 'many' })
    expect(p.json('.bildr/modules/blog/actions/create-blog-tag.json')).toMatchObject({ label: 'Create blog tag', http: { method: 'POST', path: '/blog-tags' }, input: { pick: ['id', 'label'] } })
  })

  it('rest: only the operations with endpoints; an "id" field keeps the API\'s key; remote keys become the field map', () => {
    const p = project()
    const made = p.edit('entity_create', {
      name: 'author',
      source: 'ds_quotes',
      fields: [{ name: 'id', type: 'integer' }, { name: 'full name', type: 'text', remote: 'full_name' }],
      endpoints: { list: { path: '/authors', itemsPath: 'authors' }, get: { path: '/authors/:id' } }
    })
    expect(made.actionId).toBeUndefined()
    expect(made.queryIds).toEqual(['q_authors', 'q_author_by_id'])
    expect(p.json('.bildr/modules/blog/entities/author.json')).toMatchObject({ idStrategy: 'external', fields: [{ name: 'id', type: 'integer' }, { name: 'fullName', type: 'text' }] })
    expect(p.json('.bildr/modules/blog/repositories/author.json')).toMatchObject({
      operations: ['list', 'get'],
      rest: { list: { path: '/authors', itemsPath: 'authors' }, fieldMap: { id: 'id', fullName: 'full_name' }, get: { path: '/authors/:id' } }
    })
    expect(p.json('.bildr/modules/blog/queries/author-by-id.json').params).toEqual([{ name: 'id', type: 'integer', reactive: true }])
    expect(p.refuse('entity_create', { name: 'thing', source: 'ds_quotes', fields: [{ name: 'a', type: 'text' }] }, 'invalid').message)
      .toBe('A REST entity needs the endpoint of at least one operation (endpoints), e.g. { "list": { "path": "/posts", "itemsPath": "items" } }')
  })

  it('refuses names, plurals and fields that collide, and "id" outside REST', () => {
    const p = project()
    expect(p.refuse('entity_create', { name: 'post', source: 'ds_main', fields: [{ name: 'a', type: 'text' }] }, 'invalid').message).toBe('Module "blog" already has the entity Post (ent_post)')
    expect(p.refuse('entity_create', { name: 'article', plural: 'posts', source: 'ds_main', fields: [{ name: 'a', type: 'text' }] }, 'invalid').message).toBe('Post already uses the plural "posts" in module "blog": plurals name code and routes')
    expect(p.refuse('entity_create', { name: 'tag', source: 'ds_main', fields: [{ name: 'a', type: 'text' }, { name: 'A', type: 'text' }] }, 'invalid').message).toBe('Two fields are named "a"')
    expect(p.refuse('entity_create', { name: 'tag', source: 'ds_main', fields: [{ name: 'id', type: 'text' }] }, 'invalid').message).toBe('"id" is reserved: entities of a sqlite data source get a uuid id')
    p.refuse('entity_create', { name: 'tag', source: 'ds_nope', fields: [{ name: 'a', type: 'text' }] }, 'not_found')
  })
})

describe('entity_update and entity_delete', () => {
  it('rename and re-plural; expose off is refused while queries read the rows', () => {
    const p = project()
    p.edit('entity_update', { entity: 'ent_post', name: 'article', plural: 'articles' })
    expect(p.json('.bildr/modules/blog/entities/post.json')).toMatchObject({ name: 'Article', plural: 'articles' })
    expect(p.refuse('entity_update', { entity: 'ent_post', expose: false }, 'invalid').message).toBe('The queries q_all_posts, q_featured_posts, q_post_by_slug read Article rows in the app. Delete them first')
  })

  it('entity_delete is refused while pages use its queries, actions or fields, naming them', () => {
    const message = project().refuse('entity_delete', { entity: 'ent_post' }, 'invalid').message
    expect(message).toMatch(/^Entity Post is still used by /)
    expect(message).toContain('pg_index (uses)')
    expect(message).toContain('pg_new_post (n_form)')
    expect(message).toContain('cmp_post_card (properties)')
  })
})

describe('entity fields', () => {
  it('entity_field_add mints fld_, goes into the create action\'s input, and can be moved', () => {
    const p = project()
    expect(p.edit('entity_field_add', { entity: 'ent_post', name: 'Reading time', type: 'integer', index: 2 }).fieldId).toBe('fld_reading_time')
    expect(p.json('.bildr/modules/blog/entities/post.json').fields.map((field: { name: string }) => field.name)).toEqual(['title', 'slug', 'readingTime', 'body', 'published', 'publishedAt'])
    expect(p.json('.bildr/modules/blog/actions/create-post.json').input.pick).toEqual(['id', 'title', 'slug', 'body', 'published', 'readingTime'])
    p.edit('entity_field_move', { entity: 'ent_post', field: 'fld_reading_time', index: 0 })
    expect(p.json('.bildr/modules/blog/entities/post.json').fields[0].name).toBe('readingTime')
    expect(p.refuse('entity_field_add', { entity: 'ent_post', name: 'title', type: 'text' }, 'invalid').message).toBe('Entity Post already has a field "title"')
  })

  it('a required field is refused while fixtures rows lack it', () => {
    expect(project().refuse('entity_field_add', { entity: 'ent_post', name: 'summary', type: 'text', required: true }, 'invalid').message)
      .toBe('summary would be required but fixtures row 1, fixtures row 2 have no value for it: add it as optional, fill them in, then make it required')
  })

  it('entity_field_remove is refused while queries, actions or pages use the field; otherwise it leaves the picks and fixtures', () => {
    const p = project()
    const message = p.refuse('entity_field_remove', { entity: 'ent_post', field: 'fld_slug' }, 'invalid').message
    expect(message).toMatch(/^slug is used by /)
    expect(message).toContain('q_post_by_slug')
    expect(message).toContain('act_create_post')
    // The finder of its repository, as the usage index names it.
    expect(message).toContain('ent_post (repository)')
    p.edit('entity_field_add', { entity: 'ent_post', name: 'subtitle', type: 'text' })
    p.edit('entity_field_remove', { entity: 'ent_post', field: 'fld_subtitle' })
    expect(p.json('.bildr/modules/blog/actions/create-post.json').input.pick).toEqual(['id', 'title', 'slug', 'body', 'published'])
    expect(p.refuse('entity_field_remove', { entity: 'ent_post', field: 'fld_body' }, 'invalid').message).toContain('pg_post_detail')
  })

  it('entity_field_update checks a new type against the default, the fixtures and query conditions', () => {
    const p = project()
    expect(p.refuse('entity_field_update', { entity: 'ent_post', field: 'fld_published', type: 'integer' }, 'invalid').message)
      .toBe('published can\'t be a integer: its default false, fixtures row 1, fixtures row 2, the condition of q_featured_posts hold values it can\'t take')
    expect(p.refuse('entity_field_update', { entity: 'ent_post', field: 'fld_title', type: 'boolean' }, 'invalid').message).toBe('title has min/max: a boolean field takes neither (remove them first)')
    p.edit('entity_field_add', { entity: 'ent_post', name: 'words', type: 'text' })
    p.edit('entity_field_update', { entity: 'ent_post', field: 'fld_words', type: 'integer', name: 'wordCount' })
    expect(p.json('.bildr/modules/blog/entities/post.json').fields.at(-1)).toEqual({ id: 'fld_words', name: 'wordCount', type: 'integer' })
    expect(p.json('.bildr/modules/blog/actions/create-post.json').input.pick.at(-1)).toBe('wordCount')
    expect(p.refuse('entity_field_update', { entity: 'ent_post', field: 'fld_slug', name: 'handle' }, 'invalid').message).toMatch(/^slug is used by /)
  })
})

describe('data sources', () => {
  it('rest: settings get env vars; the secret is an env var only', () => {
    const p = project()
    const made = p.edit('datasource_create', { name: 'Billing API', kind: 'rest', defaults: { baseUrl: 'https://billing.example.com/v1' }, auth: { type: 'header', header: 'X-Api-Key' } })
    expect(made).toMatchObject({ datasourceId: 'ds_billing_api', database: false })
    expect(p.json('.bildr/datasources/billing-api.json')).toEqual({
      id: 'ds_billing_api',
      name: 'billing-api',
      kind: 'rest',
      env: { baseUrl: 'NUXT_DATASOURCES_BILLING_API_BASE_URL', apiKey: 'NUXT_DATASOURCES_BILLING_API_API_KEY' },
      defaults: { baseUrl: 'https://billing.example.com/v1' },
      auth: { type: 'header', secret: 'apiKey', header: 'X-Api-Key' }
    })
    expect(p.refuse('datasource_create', { name: 'leaky', kind: 'rest', defaults: { apiKey: 'sk-live-123' }, auth: { type: 'bearer' } }, 'invalid').message)
      .toBe('"apiKey" is a secret: set it with NUXT_DATASOURCES_LEAKY_API_KEY in .env, never in the model')
    expect(p.refuse('datasource_create', { name: 'creds', kind: 'rest', defaults: { baseUrl: 'https://me:pw@x.example.com' } }, 'invalid').message)
      .toBe('A base URL can\'t hold a user name or password: put the secret in an env var (auth)')
    p.edit('datasource_update', { datasource: 'ds_billing_api', defaults: { baseUrl: 'https://billing.example.com/v2' }, auth: null })
    expect(p.json('.bildr/datasources/billing-api.json')).toMatchObject({ defaults: { baseUrl: 'https://billing.example.com/v2' } })
    expect(p.json('.bildr/datasources/billing-api.json').auth).toBeUndefined()
  })

  it('one app database at most; deleting the last sqlite source turns it off; a used source is kept', () => {
    expect(project().refuse('datasource_create', { name: 'second', kind: 'sqlite' }, 'invalid').message)
      .toBe('The project already has its app database (ds_main): a project has at most one sqlite data source')
    expect(project().refuse('datasource_delete', { datasource: 'ds_main' }, 'invalid').message)
      .toBe('Data source "main" is used by the repository repo_post. Delete their entities first')
    const p = apiOnly()
    const made = p.edit('datasource_create', { name: 'main', kind: 'sqlite' })
    expect(made).toMatchObject({ datasourceId: 'ds_main', database: true, packageJson: { dependencies: { 'drizzle-orm': expect.any(String) } } })
    expect(p.json('.bildr/datasources/main.json')).toEqual({ id: 'ds_main', name: 'main', kind: 'sqlite', env: { url: 'NUXT_DB_URL' }, defaults: { url: 'file:.data/app.db' } })
    expect(p.edit('datasource_delete', { datasource: 'ds_main' })).toMatchObject({ database: false, changes: [{ path: '.bildr/datasources/main.json', content: null }] })
  })

  it('memory sources have no settings', () => {
    expect(project().refuse('datasource_create', { name: 'scratch', kind: 'memory', defaults: { baseUrl: 'https://x.example.com' } }, 'invalid').message)
      .toBe('A memory data source keeps its rows in the server process: it has no settings')
  })
})
