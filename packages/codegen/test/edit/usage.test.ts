import { describe, expect, it } from 'vitest'
import { usesOf } from '../../src/edit/index'
import { project } from './helpers'

/** D10a (S10): the shared usage index that deletes, renames and (later) "Used in" read. */

describe('usesOf', () => {
  const model = () => project().model()

  it('lists the pages that use a query, by use and by the names they bind it as', () => {
    const uses = usesOf(model(), 'q_featured_posts')
    expect(uses).toContainEqual({ kind: 'page', id: 'pg_index', name: 'index', via: 'uses', where: 'uses', as: 'featured' })
    // The computed value `posts` binds the alias.
    expect(uses).toContainEqual({ kind: 'page', id: 'pg_index', name: 'index', via: 'bind', where: 'computed', as: 'featured' })
    expect(uses.every(use => use.kind === 'page')).toBe(true)
  })

  it('names the nodes that bind a query\'s alias', () => {
    const uses = usesOf(model(), 'q_post_by_slug')
    expect(uses).toContainEqual({ kind: 'page', id: 'pg_post_detail', name: 'posts-slug', via: 'uses', where: 'uses', as: 'post' })
    expect(uses).toContainEqual({ kind: 'page', id: 'pg_post_detail', name: 'posts-slug', via: 'bind', where: 'n_title', node: 'n_title', as: 'post' })
  })

  it('lists forms, interactions and uses of an action', () => {
    const uses = usesOf(model(), 'act_create_post')
    expect(uses).toContainEqual({ kind: 'page', id: 'pg_new_post', name: 'posts-new', via: 'uses', where: 'uses', as: 'createPost' })
    expect(uses).toContainEqual({ kind: 'page', id: 'pg_new_post', name: 'posts-new', via: 'form', where: 'n_form', node: 'n_form' })
    expect(uses).toContainEqual({ kind: 'page', id: 'pg_new_post', name: 'posts-new', via: 'interaction', where: 'n_form', node: 'n_form' })
    expect(uses).toContainEqual({ kind: 'page', id: 'pg_new_post', name: 'posts-new', via: 'bind', where: 'n_error', node: 'n_error', as: 'createPost' })
  })

  it('lists components and the actions that use an entity', () => {
    const uses = usesOf(model(), 'ent_post')
    expect(uses).toContainEqual({ kind: 'component', id: 'cmp_post_card', name: 'PostCard', via: 'properties', where: 'properties' })
    expect(uses).toContainEqual({ kind: 'action', id: 'act_create_post', name: 'createPost', via: 'input', where: 'input' })
    expect(uses).toContainEqual({ kind: 'action', id: 'act_publish_post', name: 'publishPost', via: 'output', where: 'output' })
  })

  it('never lists an artifact as a user of itself, and is empty for an unused one', () => {
    const p = project()
    p.edit('query_create', { entity: 'ent_post', result: 'many', name: 'spare' })
    expect(usesOf(p.model(), 'q_spare')).toEqual([])
    expect(usesOf(p.model(), 'act_create_post').some(use => use.kind === 'action' && use.id === 'act_create_post')).toBe(false)
  })

  it('finds uses in layouts and in interactions of any node', () => {
    const m = model()
    m.layouts[0]!.root.children![0]!.interactions = [{ on: 'click', do: [{ kind: 'runAction', action: 'act_publish_post', args: {} }] }]
    const uses = usesOf(m, 'act_publish_post')
    expect(uses).toContainEqual(expect.objectContaining({ kind: 'layout', id: 'lay_main', via: 'interaction' }))
  })
})
