import { describe, expect, it } from 'vitest'
import { generate } from '../../src/generate/index'
import { IDX, project } from './helpers'

/** P5 (mapping §4, Q5): a list's query, its sort/filter/limit, and what a page uses. */

const QUERIES = '.bildr/modules/blog/queries'
const featured = `${QUERIES}/featured-posts.json`
const all = `${QUERIES}/all-posts.json`

/** A second page that reads `q_all_posts`, so that query is shared. */
const sharedAll = () => {
  const p = project()
  p.edit('page_create', { name: 'archive' })
  p.edit('page_use_add', { page: 'pg_archive', as: 'everything', query: 'q_all_posts' })
  return p
}

describe('query_update', () => {
  it('edits a query in place while one page use reads it', () => {
    const p = project()
    const out = p.edit('query_update', {
      query: 'q_featured_posts', page: 'pg_index', as: 'featured',
      orderBy: [{ field: 'title', direction: 'asc' }], where: { op: 'ne', field: 'slug', value: 'a-draft' }, limit: 3
    })
    expect(out).toMatchObject({ queryId: 'q_featured_posts', forked: false })
    expect(p.json(featured)).toMatchObject({ orderBy: [{ field: 'title', direction: 'asc' }], where: { op: 'ne', field: 'slug', value: 'a-draft' }, limit: 3 })
    expect(p.json(IDX).uses.queries.find((use: { as: string }) => use.as === 'featured').query).toBe('q_featured_posts')
  })

  it('removes a condition, an ordering or a limit with null', () => {
    const p = project()
    p.edit('query_update', { query: 'q_featured_posts', where: null, orderBy: null, limit: null })
    const file = p.json(featured)
    expect(file).not.toHaveProperty('where')
    expect(file).not.toHaveProperty('orderBy')
    expect(file).not.toHaveProperty('limit')
  })

  it('edits the shared query for every use when no use is named (an agent\'s edit)', () => {
    const p = sharedAll()
    expect(p.edit('query_update', { query: 'q_all_posts', limit: 2 })).toMatchObject({ forked: false })
    expect(p.json(all).limit).toBe(2)
  })

  it('copies a shared query as q_<page>_<as> for the use being edited and repoints it (Q5)', () => {
    const p = sharedAll()
    const out = p.edit('query_update', { query: 'q_all_posts', page: 'pg_archive', as: 'everything', orderBy: [{ field: 'title', direction: 'asc' }], limit: 5 })
    expect(out).toMatchObject({ queryId: 'q_archive_everything', forked: true })
    expect(p.json(all)).not.toHaveProperty('limit')
    expect(p.json(all).orderBy).toEqual([{ field: 'createdAt', direction: 'desc' }])
    const copy = p.json(`${QUERIES}/archive-everything.json`)
    expect(copy).toMatchObject({ id: 'q_archive_everything', name: 'archiveEverything', from: 'ent_post', result: 'many', limit: 5, orderBy: [{ field: 'title', direction: 'asc' }] })
    expect(p.json('.bildr/modules/blog/pages/archive.json').uses.queries).toEqual([{ as: 'everything', query: 'q_archive_everything' }])
    expect(p.json(IDX).uses.queries.find((use: { as: string }) => use.as === 'all').query).toBe('q_all_posts')
  })

  it('refuses fields the entity lacks, parameters the query lacks, a bad limit and a page without the use', () => {
    const p = project()
    expect(p.refuse('query_update', { query: 'q_all_posts', orderBy: [{ field: 'nope', direction: 'asc' }] }, 'invalid').message).toMatch(/Post has no field "nope"/)
    p.refuse('query_update', { query: 'q_all_posts', where: { op: 'eq', field: 'nope', value: 1 } }, 'invalid')
    expect(p.refuse('query_update', { query: 'q_all_posts', limit: { $param: 'size' } }, 'invalid').message).toMatch(/no parameter "size"/)
    p.refuse('query_update', { query: 'q_all_posts', limit: -1 }, 'invalid')
    p.refuse('query_update', { query: 'q_all_posts', limit: 1.5 }, 'invalid')
    p.refuse('query_update', { query: 'q_all_posts', page: 'pg_index' }, 'invalid')
    p.refuse('query_update', { query: 'q_all_posts', page: 'pg_index', as: 'featured' }, 'invalid')
    p.refuse('query_update', { query: 'q_nope', limit: 1 }, 'not_found')
  })
})

describe('query_create_for_list', () => {
  it('creates q_<page>_<as> over the entity, used by the page, and binds a List to it', () => {
    const p = project()
    p.edit('page_create', { name: 'gallery' })
    const list = p.edit('node_insert', { file: 'pg_gallery', type: 'List' })
    const out = p.edit('query_create_for_list', { page: 'pg_gallery', entity: 'ent_post', nodeId: list.nodeId })
    expect(out).toMatchObject({ queryId: 'q_gallery_posts', as: 'posts' })
    expect(p.json(`${QUERIES}/gallery-posts.json`)).toMatchObject({ id: 'q_gallery_posts', name: 'galleryPosts', label: 'Gallery posts', from: 'ent_post', params: [], result: 'many' })
    const page = p.json('.bildr/modules/blog/pages/gallery.json')
    expect(page.uses).toEqual({ queries: [{ as: 'posts', query: 'q_gallery_posts' }] })
    expect(page.root.children[0].props).toEqual({ items: { $bind: 'posts' }, as: 'post' })
    expect(() => generate(p.model())).not.toThrow()
  })

  it('keeps the List\'s own item name, and takes another name for the rows', () => {
    const p = project()
    p.edit('page_create', { name: 'gallery' })
    const list = p.edit('node_insert', { file: 'pg_gallery', type: 'List', props: { as: 'entry' } })
    expect(p.edit('query_create_for_list', { page: 'pg_gallery', entity: 'ent_post', as: 'recent', nodeId: list.nodeId })).toMatchObject({ queryId: 'q_gallery_recent', as: 'recent' })
    expect(p.json('.bildr/modules/blog/pages/gallery.json').root.children[0].props).toEqual({ items: { $bind: 'recent' }, as: 'entry' })
  })

  it('takes the first free name when none is given: a second list of the same entity on a page', () => {
    const p = project()
    expect(p.edit('query_create_for_list', { page: 'pg_index', entity: 'ent_post' })).toMatchObject({ as: 'posts2', queryId: 'q_index_posts2' })
    expect(p.edit('query_create_for_list', { page: 'pg_index', entity: 'ent_post' })).toMatchObject({ as: 'posts3' })
    expect(p.json(IDX).uses.queries.map((use: { as: string }) => use.as)).toEqual(expect.arrayContaining(['posts2', 'posts3']))
    expect(() => generate(p.model())).not.toThrow()
  })

  it('creates the query without a List, and refuses a taken name, a node that is no List and an entity without a list', () => {
    const p = project()
    p.edit('query_create_for_list', { page: 'pg_index', entity: 'ent_post', as: 'extra' })
    expect(p.json(IDX).uses.queries.map((use: { as: string }) => use.as)).toContain('extra')
    p.refuse('query_create_for_list', { page: 'pg_index', entity: 'ent_post', as: 'all' }, 'invalid')
    p.refuse('query_create_for_list', { page: 'pg_index', entity: 'ent_post', as: 'site' }, 'invalid')
    p.refuse('query_create_for_list', { page: 'pg_index', entity: 'ent_post', as: 'more', nodeId: 'n_h1' }, 'invalid')
    p.refuse('query_create_for_list', { page: 'pg_index', entity: 'ent_nope' }, 'not_found')
  })

  it('says where to expose the list of an entity that has none: the collection\'s JSON tab, under Repository', () => {
    const p = project()
    p.edit('entity_create', { name: 'blog tag', source: 'ds_main', expose: false, fields: [{ name: 'label', type: 'text', required: true }] })
    const message = p.refuse('query_create_for_list', { page: 'pg_index', entity: 'ent_blog_tag' }, 'invalid').message
    expect(message).toBe('BlogTag has no list the app can read: expose its list in the collection\'s JSON tab, under Repository')
    expect(message).not.toContain('Model screen')
  })
})

describe('page_use_add, page_use_update and page_use_remove', () => {
  it('adds a query use with arguments, an action use, and updates the arguments', () => {
    const p = project()
    p.edit('page_use_add', { page: 'pg_index', as: 'few', query: 'q_featured_posts', args: { limit: 2 } })
    p.edit('page_use_add', { page: 'pg_index', as: 'create', action: 'act_create_post' })
    expect(p.json(IDX).uses.queries.at(-1)).toEqual({ as: 'few', query: 'q_featured_posts', args: { limit: 2 } })
    expect(p.json(IDX).uses.actions).toEqual([{ as: 'create', action: 'act_create_post' }])
    p.edit('page_use_update', { page: 'pg_index', as: 'few', args: { limit: 9 } })
    expect(p.json(IDX).uses.queries.at(-1).args).toEqual({ limit: 9 })
    p.edit('page_use_update', { page: 'pg_index', as: 'few', args: { limit: null } })
    expect(p.json(IDX).uses.queries.at(-1)).not.toHaveProperty('args')
  })

  it('refuses a taken or reserved name, an unknown query, action or parameter, and both or neither of query and action', () => {
    const p = project()
    p.refuse('page_use_add', { page: 'pg_index', as: 'all', query: 'q_all_posts' }, 'invalid')
    p.refuse('page_use_add', { page: 'pg_index', as: 'toast', query: 'q_all_posts' }, 'invalid')
    p.refuse('page_use_add', { page: 'pg_index', as: 'x', query: 'q_nope' }, 'not_found')
    p.refuse('page_use_add', { page: 'pg_index', as: 'x', action: 'act_nope' }, 'not_found')
    p.refuse('page_use_add', { page: 'pg_index', as: 'x', query: 'q_all_posts', args: { nope: 1 } }, 'invalid')
    p.refuse('page_use_add', { page: 'pg_index', as: 'x' }, 'invalid')
    p.refuse('page_use_add', { page: 'pg_index', as: 'x', query: 'q_all_posts', action: 'act_create_post' }, 'invalid')
    p.refuse('page_use_update', { page: 'pg_index', as: 'quotes', args: { nope: 1 } }, 'invalid')
    p.refuse('page_use_update', { page: 'pg_index', as: 'nope', args: {} }, 'not_found')
  })

  it('removes a use nothing binds, and refuses one the page still reads', () => {
    const p = project()
    p.edit('page_use_add', { page: 'pg_index', as: 'spare', query: 'q_all_posts' })
    p.edit('page_use_remove', { page: 'pg_index', as: 'spare' })
    expect(p.json(IDX).uses.queries.map((use: { as: string }) => use.as)).not.toContain('spare')
    // `featured` is read by the computed `posts`, `quotes` by a List, `preferences` by a checkbox (state: not removable here).
    expect(p.refuse('page_use_remove', { page: 'pg_index', as: 'featured' }, 'invalid').message).toMatch(/still binds "featured"/)
    p.refuse('page_use_remove', { page: 'pg_index', as: 'quotes' }, 'invalid')
    p.refuse('page_use_remove', { page: 'pg_index', as: 'nope' }, 'not_found')
  })

  it('refuses to remove an action a form runs', () => {
    const p = project()
    const used = p.json('.bildr/modules/blog/pages/new-post.json').uses.actions[0]
    expect(p.refuse('page_use_remove', { page: 'pg_new_post', as: used.as }, 'invalid').message).toMatch(new RegExp(`"${used.as}"`))
  })
})

describe('a Form\'s action (one change set: the page use and the prop)', () => {
  it('node_insert of a Form with an action makes the page use it, under a free name', () => {
    const p = project()
    p.edit('page_create', { name: 'contact' })
    const out = p.edit('node_insert', { file: 'pg_contact', type: 'Form', props: { action: 'act_create_post', fields: [] } })
    const page = p.json('.bildr/modules/blog/pages/contact.json')
    expect(page.uses.actions).toEqual([{ as: 'createPost', action: 'act_create_post' }])
    expect(page.root.children[0]).toMatchObject({ id: out.nodeId, type: 'Form', props: { action: 'act_create_post', fields: [] } })
    expect(() => generate(p.model())).not.toThrow()
  })

  it('node_update_props of a Form\'s action reuses the use the page already has', () => {
    const p = project()
    p.edit('node_update_props', { file: 'pg_new_post', nodeId: 'n_form', props: { action: 'act_create_post' } })
    expect(p.json('.bildr/modules/blog/pages/new-post.json').uses.actions).toEqual([{ as: 'createPost', action: 'act_create_post' }])
  })

  it('refuses an action without an entity input and leaves no use behind', () => {
    const p = project()
    const before = p.files
    const refusal = p.refuse('node_update_props', { file: 'pg_new_post', nodeId: 'n_form', props: { action: 'act_publish_post', fields: [] } }, 'invalid')
    expect(refusal.message).toContain('a Form needs an action with an entity input')
    expect(p.files).toBe(before)
    expect(p.json('.bildr/modules/blog/pages/new-post.json').uses.actions.map((use: { as: string }) => use.as)).toEqual(['createPost'])
  })
})
