import { describe, expect, it } from 'vitest'
import { entityUsesOf, fieldUsesIndex, fieldUsesOf } from '../../src/edit/index'
import type { Model, ModelNode } from '../../src/model/schemas'
import { project } from './helpers'

/** Who uses a collection and a field, as the same structured uses `usesOf` gives. */

/** A second collection's action, and an action tied to Post by a repository step only: what the module does and does not update with a Post field. */
const withOtherActions = (m: Model) => {
  const blog = m.modules.blog!
  const base = { label: 'x', http: { method: 'POST', path: '/x' }, errors: [], client: { invalidates: [] } } as const
  // Its input is a Quote's: it picks a field of that name, and returns a Post.
  blog.actions.push({ ...base, id: 'act_other', name: 'other', http: { method: 'POST', path: '/other' }, input: { entity: 'ent_quote', pick: ['title'] }, output: { entity: 'ent_post' }, steps: [{ kind: 'validate' }] })
  // No entity of its own: it reaches Post only through its repository.
  blog.actions.push({ ...base, id: 'act_touch', name: 'touch', http: { method: 'POST', path: '/touch' }, input: {}, steps: [{ kind: 'repository', repository: 'repo_post', op: 'create', set: { subtitle: 'x' } }] })
  return m
}

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

  it('names a binding by its path, even under an item name a List gives that shadows the page\'s alias', () => {
    const m = model()
    const list = m.modules.blog!.pages.find(page => page.id === 'pg_post_detail')!
    list.root.children!.push({ id: 'n_shadow', type: 'List', props: { items: { $bind: 'post' }, as: 'post' }, children: [{ id: 'n_shadow_text', type: 'Text', props: { text: { $bind: 'post.body' } } }] })
    // The module refuses a field a binding of such a page names, whatever the path stands for (it does not resolve the List's item name), so the index counts it.
    expect(fieldUsesOf(m, 'ent_post', 'body')).toContainEqual({ kind: 'page', id: 'pg_post_detail', name: 'posts-slug', via: 'bind', where: 'n_shadow_text', node: 'n_shadow_text', as: 'post' })
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

  it('follows a pick only where the module rewrites it: the actions whose input is this collection\'s', () => {
    const m = withOtherActions(project().model())
    // Post's create action picks `title` and follows its rename; the action on a Quote picks a Quote's field: nothing of Post's.
    expect(fieldUsesOf(m, 'ent_post', 'title').filter(use => use.via === 'pick')).toEqual([{ kind: 'action', id: 'act_create_post', name: 'createPost', via: 'pick', where: 'input', follows: true }])
    expect(fieldUsesOf(m, 'ent_post', 'text')).toEqual([])
  })

  it('does not count an action that reaches the collection only through a repository step: the module does not look at it for a field', () => {
    const m = withOtherActions(project().model())
    expect(fieldUsesOf(m, 'ent_post', 'subtitle')).toEqual([])
    // ...but deleting the collection takes it along: it follows.
    expect(entityUsesOf(m, 'ent_post')).toContainEqual({ kind: 'action', id: 'act_touch', name: 'touch', via: 'step', where: 'steps', follows: true })
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

  it('finds the finders and the list order of its repository, and a field named like a step key', () => {
    const post = fieldUsesOf(model(), 'ent_post', 'slug')
    expect(post).toContainEqual({ kind: 'entity', id: 'ent_post', name: 'Post', via: 'finder', where: 'repository' })
    expect(fieldUsesOf(model(), 'ent_post', 'createdAt')).toContainEqual({ kind: 'entity', id: 'ent_post', name: 'Post', via: 'orderBy', where: 'repository' })
    // The create action's steps have a `kind` and an `op` key: a field with either name is named there.
    const m = model()
    m.modules.blog!.entities[0]!.fields.push({ id: 'fld_kind', name: 'kind', type: 'text' })
    expect(fieldUsesOf(m, 'ent_post', 'kind')).toContainEqual({ kind: 'action', id: 'act_create_post', name: 'createPost', via: 'step', where: 'steps' })
  })

  it('reads the model in one pass, however many fields the collection has, and one field costs no more', () => {
    const fields = (count: number) => {
      const m = model()
      const post = m.modules.blog!.entities[0]!
      for (let index = 0; index < count; index++) post.fields.push({ id: `fld_extra_${index}`, name: `extra${index}`, type: 'text' })
      // 200 nodes on a page that reads the posts, each binding one of the fields.
      const detail = m.modules.blog!.pages.find(page => page.id === 'pg_post_detail')!
      for (let index = 0; index < 200; index++) detail.root.children!.push({ id: `n_bulk_${index}`, type: 'Text', props: { text: { $bind: `post.extra${index % Math.max(count, 1)}` } } })
      // Every read of a node's children is one step of a walk over a tree.
      let reads = 0
      const countReads = (node: ModelNode) => {
        const children = node.children
        Object.defineProperty(node, 'children', { get: () => (reads++, children), enumerable: true, configurable: true })
        children?.forEach(countReads)
      }
      for (const mod of Object.values(m.modules)) for (const owner of [...mod.pages, ...mod.components]) countReads(owner.root)
      for (const layout of m.layouts) countReads(layout.root)
      return {
        m,
        reads: () => reads,
        reset: () => {
          reads = 0
        }
      }
    }
    const few = fields(2)
    fieldUsesIndex(few.m, 'ent_post')
    const many = fields(50)
    fieldUsesIndex(many.m, 'ent_post')
    // Same trees but for the 200 nodes in both: the walks do not grow with the fields.
    expect(many.reads()).toBe(few.reads())
    const all = many.reads()
    many.reset()
    expect(fieldUsesOf(many.m, 'ent_post', 'extra7')).toContainEqual(expect.objectContaining({ via: 'bind', node: 'n_bulk_7' }))
    expect(many.reads()).toBe(all)
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
