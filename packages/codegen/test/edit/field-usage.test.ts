import { describe, expect, it } from 'vitest'
import { entityUsesOf, fieldUsesIndex, fieldUsesOf } from '../../src/edit/index'
import { project } from './helpers'

/** D5 (S5): who uses a collection and a field, as the same structured uses `usesOf` gives. */

describe('fieldUsesOf', () => {
  const model = () => project().model()

  it('finds the nodes and the SEO field that bind the field through the alias a page reads its query as', () => {
    const uses = fieldUsesOf(model(), 'ent_post', 'title')
    expect(uses).toContainEqual({ kind: 'page', id: 'pg_post_detail', name: 'posts-slug', via: 'bind', where: 'n_title', node: 'n_title', as: 'post' })
    expect(uses).toContainEqual({ kind: 'page', id: 'pg_post_detail', name: 'posts-slug', via: 'bind', where: 'seo', as: 'post' })
  })

  it('finds the bindings inside a component, through the entity property it reads the row as', () => {
    const uses = fieldUsesOf(model(), 'ent_post', 'title')
    expect(uses).toContainEqual({ kind: 'component', id: 'cmp_post_card', name: 'PostCard', via: 'bind', where: 'n_title', node: 'n_title', as: 'post' })
    expect(uses).toContainEqual({ kind: 'component', id: 'cmp_post_card', name: 'PostCard', via: 'bind', where: 'n_cover', node: 'n_cover', as: 'post' })
  })

  it('finds a list item binding, with the item name, through a computed value that reads the query', () => {
    const post = fieldUsesOf(model(), 'ent_post', 'slug')
    expect(post).toContainEqual({ kind: 'page', id: 'pg_index', name: 'index', via: 'bind', where: 'n_read_more', node: 'n_read_more', as: 'post' })
    const quote = fieldUsesOf(model(), 'ent_quote', 'text')
    expect(quote).toContainEqual({ kind: 'page', id: 'pg_index', name: 'index', via: 'bind', where: 'n_quote', node: 'n_quote', as: 'quote' })
  })

  it('does not take a path of another collection\'s row for the field', () => {
    expect(fieldUsesOf(model(), 'ent_post', 'text')).toEqual([])
    expect(fieldUsesOf(model(), 'ent_quote', 'title')).toEqual([])
  })

  it('does not take an item name a List shadows for the page\'s own alias', () => {
    const m = model()
    const list = m.modules.blog!.pages.find(page => page.id === 'pg_post_detail')!
    list.root.children!.push({ id: 'n_shadow', type: 'List', props: { items: { $bind: 'post' }, as: 'post' }, children: [{ id: 'n_shadow_text', type: 'Text', props: { text: { $bind: 'post.body' } } }] })
    // `post` is a row here, not a list: the List binds the alias, which is no list of rows, so the item reads nothing of the collection.
    expect(fieldUsesOf(m, 'ent_post', 'body').some(use => use.node === 'n_shadow_text')).toBe(false)
  })

  it('finds the queries that filter and order by the field', () => {
    const published = fieldUsesOf(model(), 'ent_post', 'published')
    expect(published).toContainEqual({ kind: 'query', id: 'q_featured_posts', name: 'featuredPosts', via: 'where', where: 'where' })
    const createdAt = fieldUsesOf(model(), 'ent_post', 'createdAt')
    expect(createdAt).toContainEqual({ kind: 'query', id: 'q_all_posts', name: 'allPosts', via: 'orderBy', where: 'orderBy' })
    expect(fieldUsesOf(model(), 'ent_quote', 'id')).toContainEqual({ kind: 'query', id: 'q_latest_quotes', name: 'latestQuotes', via: 'orderBy', where: 'orderBy' })
  })

  it('finds the actions that pick the field, which follow it, and the ones that set it in their steps, which do not', () => {
    const uses = fieldUsesOf(model(), 'ent_post', 'publishedAt')
    expect(uses).toContainEqual({ kind: 'action', id: 'act_create_post', name: 'createPost', via: 'set', where: 'steps' })
    expect(uses).toContainEqual({ kind: 'action', id: 'act_publish_post', name: 'publishPost', via: 'set', where: 'steps' })
    const title = fieldUsesOf(model(), 'ent_post', 'title')
    expect(title).toContainEqual({ kind: 'action', id: 'act_create_post', name: 'createPost', via: 'pick', where: 'input', follows: true })
    expect(title.some(use => use.via === 'set')).toBe(false)
  })

  it('finds the form fields that hold the field\'s id, and the route parameter it validates', () => {
    const title = fieldUsesOf(model(), 'ent_post', 'title')
    expect(title).toContainEqual({ kind: 'page', id: 'pg_new_post', name: 'posts-new', via: 'field', where: 'n_title', node: 'n_title' })
    expect(title).toContainEqual({ kind: 'page', id: 'pg_new_post', name: 'posts-new', via: 'field', where: 'n_form', node: 'n_form' })
    expect(fieldUsesOf(model(), 'ent_post', 'slug')).toContainEqual({ kind: 'page', id: 'pg_post_detail', name: 'posts-slug', via: 'param', where: 'uses' })
  })

  it('is empty for a field nothing uses, and for a name the collection does not have', () => {
    const p = project()
    p.edit('entity_field_add', { entity: 'ent_post', name: 'spare', type: 'text' })
    const added = fieldUsesOf(p.model(), 'ent_post', 'spare')
    // The create action picks every new field: it follows the field, and nothing else holds it.
    expect(added.every(use => use.follows)).toBe(true)
    expect(fieldUsesOf(p.model(), 'ent_post', 'nope')).toEqual([])
    expect(fieldUsesOf(p.model(), 'ent_nope', 'title')).toEqual([])
  })

  it('gives every field in one scan', () => {
    const index = fieldUsesIndex(model(), 'ent_post')
    expect(index.get('title')).toEqual(fieldUsesOf(model(), 'ent_post', 'title'))
    expect(index.get('published')).toEqual(fieldUsesOf(model(), 'ent_post', 'published'))
  })
})

describe('entityUsesOf', () => {
  const model = () => project().model()

  it('lists the pages that read its queries, with the query they read them through', () => {
    const uses = entityUsesOf(model(), 'ent_post')
    expect(uses).toContainEqual({ kind: 'page', id: 'pg_index', name: 'index', via: 'uses', where: 'uses', as: 'featured', by: 'q_featured_posts' })
    expect(uses).toContainEqual({ kind: 'page', id: 'pg_post_detail', name: 'posts-slug', via: 'uses', where: 'uses', as: 'post', by: 'q_post_by_slug' })
    expect(uses.some(use => use.id === 'pg_index' && use.by === 'q_latest_quotes')).toBe(false)
  })

  it('lists the list sources: the List that shows its rows, through the alias or a computed value', () => {
    const uses = entityUsesOf(model(), 'ent_post')
    expect(uses).toContainEqual({ kind: 'page', id: 'pg_index', name: 'index', via: 'list', where: 'n_list', node: 'n_list', as: 'post' })
    expect(uses.some(use => use.via === 'list' && use.where === 'n_quotes')).toBe(false)
    expect(entityUsesOf(model(), 'ent_quote')).toContainEqual({ kind: 'page', id: 'pg_index', name: 'index', via: 'list', where: 'n_quotes', node: 'n_quotes', as: 'quote' })
  })

  it('lists the forms that run its actions and the fields they hold, and the components with a property for it', () => {
    const uses = entityUsesOf(model(), 'ent_post')
    expect(uses).toContainEqual({ kind: 'page', id: 'pg_new_post', name: 'posts-new', via: 'form', where: 'n_form', node: 'n_form', by: 'act_create_post' })
    expect(uses).toContainEqual({ kind: 'page', id: 'pg_new_post', name: 'posts-new', via: 'field', where: 'n_title', node: 'n_title' })
    expect(uses).toContainEqual({ kind: 'component', id: 'cmp_post_card', name: 'PostCard', via: 'properties', where: 'properties' })
  })

  it('lists the actions on it: its own follow it when it is deleted, the others do not', () => {
    const uses = entityUsesOf(model(), 'ent_post')
    expect(uses).toContainEqual({ kind: 'action', id: 'act_create_post', name: 'createPost', via: 'input', where: 'input', follows: true })
    expect(uses).toContainEqual({ kind: 'action', id: 'act_create_post', name: 'createPost', via: 'step', where: 'steps', follows: true })
    expect(uses).toContainEqual({ kind: 'action', id: 'act_publish_post', name: 'publishPost', via: 'output', where: 'output', follows: true })
    expect(uses.filter(use => use.kind === 'page').some(use => use.follows)).toBe(false)
  })

  it('has nothing outside it for a collection no page reads: only its own queries and actions, which follow it', () => {
    const p = project()
    const made = p.edit('entity_create', { name: 'Tag', source: 'ds_main', fields: [{ name: 'label', type: 'text' }] })
    const uses = entityUsesOf(p.model(), made.entityId as string)
    expect(uses.length).toBeGreaterThan(0)
    expect(uses.every(use => use.follows)).toBe(true)
    expect(entityUsesOf(p.model(), 'ent_nope')).toEqual([])
  })
})
