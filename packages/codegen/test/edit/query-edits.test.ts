import { describe, expect, it } from 'vitest'
import { generate } from '../../src/generate/index'
import { project } from './helpers'
import type { Json } from './helpers'

/** D10a (S10): queries as first-class artifacts: create, edit in place, rename and delete. */

const QUERIES = '.bildr/modules/blog/queries'

/** The model loads and the whole app generates; returns the generated file paths. */
const generates = (p: ReturnType<typeof project>) => generate(p.model()).map(file => file.path)

describe('query_create', () => {
  it('many: all the entity\'s rows, no condition, a valid model that generates its composable', () => {
    const p = project()
    const made = p.edit('query_create', { entity: 'ent_post', result: 'many', name: 'recentPosts' })
    expect(made).toMatchObject({ queryId: 'q_recent_posts', filePath: `${QUERIES}/recent-posts.json` })
    expect(p.json(`${QUERIES}/recent-posts.json`)).toEqual({
      id: 'q_recent_posts', name: 'recentPosts', label: 'Recent posts', from: 'ent_post', params: [], result: 'many'
    })
    expect(made.changes.map((change: { path: string }) => change.path)).toEqual([`${QUERIES}/recent-posts.json`])
    expect(generates(p)).toContain('layers/blog/app/composables/blog/useRecentPosts.ts')
  })

  it('one: a where on the id and an id param of the entity\'s key type', () => {
    const p = project()
    p.edit('query_create', { entity: 'ent_post', result: 'one', name: 'postById', label: 'One post' })
    expect(p.json(`${QUERIES}/post-by-id.json`)).toMatchObject({
      id: 'q_post_by_id', label: 'One post', result: 'one',
      params: [{ name: 'id', type: 'uuid', reactive: true }],
      where: { op: 'eq', field: 'id', value: { $param: 'id' } }
    })
    expect(generates(p)).toContain('layers/blog/app/composables/blog/usePostById.ts')
  })

  it('one over a REST entity takes the type of the API\'s own id field', () => {
    const p = project()
    p.edit('entity_create', {
      name: 'author', source: 'ds_quotes', fields: [{ name: 'id', type: 'integer' }, { name: 'name', type: 'text' }],
      endpoints: { list: { path: '/authors', itemsPath: 'authors' }, get: { path: '/authors/:id' } }
    })
    p.edit('query_create', { entity: 'ent_author', result: 'one', name: 'oneAuthor' })
    expect(p.json(`${QUERIES}/one-author.json`).params).toEqual([{ name: 'id', type: 'integer', reactive: true }])
    generates(p)
  })

  it('normalises a spaced name to camelCase, and keeps a camelCase one as given', () => {
    const p = project()
    p.edit('query_create', { entity: 'ent_post', result: 'many', name: 'Post list' })
    expect(p.json(`${QUERIES}/post-list.json`).name).toBe('postList')
    p.edit('query_create', { entity: 'ent_post', result: 'many', name: 'postByID' })
    expect(p.json(`${QUERIES}/post-by-id.json`).name).toBe('postByID')
  })

  it('refuses a bad name, a taken name (any case, queries and actions), and a reserved one', () => {
    const p = project()
    expect(p.refuse('query_create', { entity: 'ent_post', result: 'many', name: '123' }, 'invalid').message).toMatch(/can't be a query name/)
    expect(p.refuse('query_create', { entity: 'ent_post', result: 'many', name: '' }, 'invalid_input').message).toBeTruthy()
    expect(p.refuse('query_create', { entity: 'ent_post', result: 'many', name: 'allPosts' }, 'invalid').message).toBe('Module "blog" already has the query allPosts (q_all_posts)')
    expect(p.refuse('query_create', { entity: 'ent_post', result: 'many', name: 'ALLPOSTS' }, 'invalid').message).toMatch(/already has the query allPosts/)
    expect(p.refuse('query_create', { entity: 'ent_post', result: 'many', name: 'createPost' }, 'invalid').message).toBe('Module "blog" already has the action createPost (act_create_post)')
    expect(p.refuse('query_create', { entity: 'ent_post', result: 'many', name: 'delete' }, 'invalid').message).toMatch(/reserved word/)
  })

  it('refuses an unknown entity, an unlisted one, another module\'s, and a bad result', () => {
    const p = project()
    p.refuse('query_create', { entity: 'ent_nope', result: 'many', name: 'x' }, 'not_found')
    p.refuse('query_create', { entity: 'ent_post', result: 'some', name: 'x' }, 'invalid_input')
    p.refuse('query_create', { module: 'nope', entity: 'ent_post', result: 'many', name: 'x' }, 'not_found')
    p.edit('entity_create', { name: 'tag', source: 'ds_main', expose: false, fields: [{ name: 'label', type: 'text' }] })
    expect(p.refuse('query_create', { entity: 'ent_tag', result: 'many', name: 'x' }, 'invalid').message).toMatch(/has no list the app can read/)
  })
})

describe('query_update (D10a: definition fields, in place)', () => {
  it('sets result, params, description, label and the existing parts in one edit', () => {
    const p = project()
    p.edit('query_create', { entity: 'ent_post', result: 'many', name: 'byTitle' })
    p.edit('query_update', {
      query: 'q_by_title', inPlace: true, result: 'one', label: 'By title', description: 'The post with this title.',
      params: [{ name: 'title', type: 'text', reactive: true }],
      where: { op: 'eq', field: 'title', value: { $param: 'title' } }
    })
    expect(p.json(`${QUERIES}/by-title.json`)).toMatchObject({
      label: 'By title', description: 'The post with this title.', result: 'one',
      params: [{ name: 'title', type: 'text', reactive: true }], where: { op: 'eq', field: 'title', value: { $param: 'title' } }
    })
    generates(p)
    p.edit('query_update', { query: 'q_by_title', inPlace: true, description: null })
    expect(p.json(`${QUERIES}/by-title.json`)).not.toHaveProperty('description')
  })

  it('edits in place when inPlace is set: never copies, even when several pages read it', () => {
    const p = project()
    p.edit('page_create', { name: 'archive' })
    p.edit('page_use_add', { page: 'pg_archive', as: 'everything', query: 'q_all_posts' })
    const out = p.edit('query_update', { query: 'q_all_posts', inPlace: true, limit: 2 })
    expect(out).toMatchObject({ queryId: 'q_all_posts', forked: false })
    expect(p.json(`${QUERIES}/all-posts.json`).limit).toBe(2)
    // The canvas flow still copies a shared query for the use it edits.
    expect(p.edit('query_update', { query: 'q_all_posts', page: 'pg_archive', as: 'everything', limit: 5 })).toMatchObject({ forked: true })
    // inPlace and a page use contradict each other.
    p.refuse('query_update', { query: 'q_all_posts', inPlace: true, page: 'pg_archive', as: 'everything', limit: 1 }, 'invalid')
  })

  it('checks conditions and params against the entity\'s fields', () => {
    const p = project()
    p.edit('query_create', { entity: 'ent_post', result: 'many', name: 'drafts' })
    const update = (input: Json) => p.refuse('query_update', { query: 'q_drafts', inPlace: true, ...input }, 'invalid').message
    // A literal that doesn't fit the field's type.
    expect(update({ where: { op: 'eq', field: 'published', value: 'yes' } })).toMatch(/where: "yes" doesn't fit published \(boolean\)/)
    expect(update({ where: { op: 'eq', field: 'nope', value: 1 } })).toMatch(/Post has no field "nope"/)
    expect(update({ where: { op: 'in', field: 'slug', value: ['a', 1] } })).toMatch(/doesn't fit slug \(text\)/)
    // A parameter the query lacks, one of the wrong type, duplicates, bad names and defaults.
    expect(update({ where: { op: 'eq', field: 'published', value: { $param: 'flag' } } })).toMatch(/no parameter "flag"/)
    expect(update({ params: [{ name: 'flag', type: 'text' }], where: { op: 'eq', field: 'published', value: { $param: 'flag' } } })).toMatch(/parameter "flag" is text but published is boolean/)
    expect(update({ params: [{ name: 'a', type: 'text' }, { name: 'a', type: 'text' }] })).toMatch(/Two parameters are named "a"/)
    expect(update({ params: [{ name: 'Bad name', type: 'text' }] })).toMatch(/can't be a parameter name/)
    expect(update({ params: [{ name: 'n', type: 'integer', default: 'many' }] })).toMatch(/parameter n: its default "many" doesn't fit integer/)
    expect(update({ limit: { $param: 'size' } })).toMatch(/no parameter "size"/)
    expect(update({ orderBy: [{ field: 'nope', direction: 'asc' }] })).toMatch(/Post has no field "nope"/)
    // A matching parameter is fine, and limit takes one too.
    p.edit('query_update', { query: 'q_drafts', inPlace: true, params: [{ name: 'flag', type: 'boolean' }, { name: 'size', type: 'integer', default: 3 }], where: { op: 'eq', field: 'published', value: { $param: 'flag' } }, limit: { $param: 'size' } })
    generates(p)
  })

  it('keeps the canvas flow\'s looser check (the list filter sends items as text) for edits that name a page use', () => {
    const p = project()
    const where = { op: 'in', field: 'published', value: ['true'] }
    p.edit('query_update', { query: 'q_featured_posts', page: 'pg_index', as: 'featured', where })
    expect(p.json(`${QUERIES}/featured-posts.json`).where).toEqual(where)
    expect(p.refuse('query_update', { query: 'q_featured_posts', inPlace: true, where }, 'invalid').message).toMatch(/"true" doesn't fit published \(boolean\)/)
  })

  it('refuses dropping a parameter the query or a page use still reads', () => {
    const p = project()
    // The query's own limit reads it.
    expect(p.refuse('query_update', { query: 'q_featured_posts', inPlace: true, params: [] }, 'invalid').message).toMatch(/limit: the query has no parameter "limit"/)
    // The index page gives `limit` as an argument.
    const refused = p.refuse('query_update', { query: 'q_featured_posts', inPlace: true, limit: null, params: [] }, 'invalid').message
    expect(refused).toContain('page "index" (pg_index) passes it as "featured"')
    p.edit('page_use_update', { page: 'pg_index', as: 'featured', args: { limit: null } })
    p.edit('query_update', { query: 'q_featured_posts', inPlace: true, limit: null, params: [] })
    expect(p.json(`${QUERIES}/featured-posts.json`).params).toEqual([])
    generates(p)
  })

  it('refuses changing one/many while a page reads the query', () => {
    const p = project()
    const message = p.refuse('query_update', { query: 'q_post_by_slug', inPlace: true, result: 'many' }, 'invalid').message
    expect(message).toBe('The query postBySlug (q_post_by_slug) is read by page "posts-slug" (pg_post_detail) as "post": changing it to many changes what they bind. Change them first')
    // Setting the same value is not a change.
    p.edit('query_update', { query: 'q_post_by_slug', inPlace: true, result: 'one' })
  })
})

describe('query_rename', () => {
  it('changes the name and nothing the pages hold: ids and aliases stay, the model still generates', () => {
    const p = project()
    const before = p.json('.bildr/modules/blog/pages/index.json')
    const out = p.edit('query_rename', { query: 'q_featured_posts', name: 'highlights' })
    expect(out).toMatchObject({ queryId: 'q_featured_posts', name: 'highlights', previousName: 'featuredPosts', composable: 'useHighlights', previousComposable: 'useFeaturedPosts' })
    expect(out.changes.map((change: { path: string }) => change.path)).toEqual([`${QUERIES}/featured-posts.json`])
    expect(p.json(`${QUERIES}/featured-posts.json`)).toMatchObject({ id: 'q_featured_posts', name: 'highlights' })
    expect(p.json('.bildr/modules/blog/pages/index.json')).toEqual(before)
    const paths = generates(p)
    expect(paths).toContain('layers/blog/app/composables/blog/useHighlights.ts')
    expect(paths).not.toContain('layers/blog/app/composables/blog/useFeaturedPosts.ts')
  })

  it('refuses a taken name (a query or an action, any case), a bad one, an unknown query', () => {
    const p = project()
    expect(p.refuse('query_rename', { query: 'q_featured_posts', name: 'allPosts' }, 'invalid').message).toBe('Module "blog" already has the query allPosts (q_all_posts)')
    expect(p.refuse('query_rename', { query: 'q_featured_posts', name: 'PUBLISHPOST' }, 'invalid').message).toMatch(/already has the action publishPost/)
    expect(p.refuse('query_rename', { query: 'q_featured_posts', name: '9' }, 'invalid').message).toMatch(/can't be a query name/)
    p.refuse('query_rename', { query: 'q_nope', name: 'fine' }, 'not_found')
  })

  it('renaming to its own name changes nothing', () => {
    const out = project().edit('query_rename', { query: 'q_featured_posts', name: 'featuredPosts' })
    expect(out.changes).toEqual([])
  })
})

describe('query_delete', () => {
  it('deletes an unused query\'s file, and the model still generates', () => {
    const p = project()
    p.edit('query_create', { entity: 'ent_post', result: 'many', name: 'spare' })
    const out = p.edit('query_delete', { query: 'q_spare' })
    expect(out).toMatchObject({ deleted: ['q_spare'] })
    expect(out.changes).toEqual([{ path: `${QUERIES}/spare.json`, content: null }])
    expect(generates(p)).not.toContain('layers/blog/app/composables/blog/useSpare.ts')
  })

  it('is refused while a page uses it, listing the page, its id and how', () => {
    const p = project()
    const message = p.refuse('query_delete', { query: 'q_featured_posts' }, 'invalid').message
    expect(message).toMatch(/^Query featuredPosts \(q_featured_posts\) is still used: /)
    expect(message).toContain('page "index" (pg_index) uses it as "featured"')
    p.refuse('query_delete', { query: 'q_nope' }, 'not_found')
  })

  it('names every page that uses it, and stops naming one once its use is removed', () => {
    const p = project()
    p.edit('page_create', { name: 'archive' })
    p.edit('page_use_add', { page: 'pg_archive', as: 'everything', query: 'q_latest_quotes' })
    expect(p.refuse('query_delete', { query: 'q_latest_quotes' }, 'invalid').message).toContain('"archive" (pg_archive)')
    p.edit('page_use_remove', { page: 'pg_archive', as: 'everything' })
    // Still used by the index page: the refusal names it only.
    expect(p.refuse('query_delete', { query: 'q_latest_quotes' }, 'invalid').message).not.toContain('pg_archive')
  })
})
