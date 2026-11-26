import { describe, expect, it } from 'vitest'
import { project } from './helpers'

/**
 * D10a (S10), "every new item is valid": an edit the model accepts must also give an app that
 * generates (no path written twice, no name the generated code can't declare) and whose types
 * line up. The compile test (generate/new-items-compile.test.ts) runs the real toolchain; these
 * are the refusals.
 */

describe('an edit that would make the generator write a path twice is refused', () => {
  it('a query named like a composable that exists (the state\'s useBlogPreferences)', () => {
    project().refuse('query_create', { entity: 'ent_post', result: 'many', name: 'blogPreferences' }, 'invalid')
  })

  it('a blank action named like a composable that exists', () => {
    project().refuse('action_create', { entity: 'ent_post', template: 'blank', name: 'blogPreferences' }, 'invalid')
  })

  it('a blank action named "index": its route is the list route\'s file', () => {
    project().refuse('action_create', { entity: 'ent_post', template: 'blank', name: 'index' }, 'invalid')
  })

  it('a route with a trailing slash that is another action\'s file', () => {
    project().refuse('action_update', { action: 'act_publish_post', http: { path: '/posts/' } }, 'invalid')
  })

  it('a rename to a name that exists as a composable', () => {
    project().refuse('query_rename', { query: 'q_all_posts', name: 'blogPreferences' }, 'invalid')
  })
})

describe('a name the generated code can\'t declare is refused', () => {
  it.each([
    'undefined', 'eval', 'arguments', // strict mode: not bindable
    'posts', 'quotes', // the composition root's repository variables
    'useBlog', 'blogErrorStatus', // its other exports
    'drizzlePostRepository', 'restQuoteRepository', // the adapters it imports
    'postNotFound', // an error factory the errors file exports
    'publishPostChange' // the domain rule of an action (T4a)
  ])('action %s', (name) => {
    project().refuse('action_create', { entity: 'ent_post', template: 'delete', name }, 'invalid')
  })

  // A query is only a composable (use<Name>), so it keeps names like "posts"; the strict-mode ones are refused for both.
  it.each(['undefined', 'eval', 'arguments'])('query %s', (name) => {
    project().refuse('query_create', { entity: 'ent_post', result: 'many', name }, 'invalid')
  })

  it('names the thing the name clashes with', () => {
    expect(project().refuse('action_create', { entity: 'ent_post', template: 'delete', name: 'posts' }, 'invalid').message).toContain('the Post repository inside the composition root')
    expect(project().refuse('action_create', { entity: 'ent_post', template: 'delete', name: 'postNotFound' }, 'invalid').message).toContain('the error "post_not_found"')
    expect(project().refuse('action_create', { entity: 'ent_post', template: 'delete', name: 'publishPostChange' }, 'invalid').message).toContain('the domain rule of the action "publishPost"')
  })

  it('an edit that gives something else a name an action already has is refused too (a new entity whose plural is an action)', () => {
    const p = project()
    p.edit('action_create', { entity: 'ent_post', template: 'delete', name: 'tags' })
    p.refuse('entity_create', { name: 'tag', source: 'ds_main', fields: [{ name: 'label', type: 'text' }] }, 'invalid')
  })

  it('a rename to one of them', () => {
    project().refuse('action_rename', { action: 'act_publish_post', name: 'blogErrorStatus' }, 'invalid')
  })
})

describe('a query parameter must fit every place it is used', () => {
  it('slug as an integer: the condition compares it with a text field', () => {
    project().refuse('query_update', { query: 'q_post_by_slug', inPlace: true, params: [{ name: 'slug', type: 'integer' }] }, 'invalid')
  })

  it('limit as text (with a text default): the limit is a number of rows', () => {
    project().refuse('query_update', { query: 'q_featured_posts', inPlace: true, params: [{ name: 'limit', type: 'text', default: 'six' }] }, 'invalid')
  })

  it('a text parameter used as the limit', () => {
    project().refuse('query_update', { query: 'q_all_posts', inPlace: true, params: [{ name: 'n', type: 'text' }], limit: { $param: 'n' } }, 'invalid')
  })

  it('still takes a parameter whose type fits', () => {
    const p = project()
    p.edit('query_update', { query: 'q_featured_posts', inPlace: true, params: [{ name: 'limit', type: 'number', default: 4 }] })
    p.edit('query_update', { query: 'q_all_posts', inPlace: true, params: [{ name: 'n', type: 'integer', default: 3 }], limit: { $param: 'n' } })
  })

  it('a page argument that no longer fits the changed type is refused', () => {
    // The home page passes featuredPosts a limit: it stays a number.
    const p = project()
    const page = p.model().modules.blog!.pages.flatMap(entry => entry.uses?.queries ?? []).find(use => use.query === 'q_featured_posts')
    expect(page?.args).toBeDefined()
    p.refuse('query_update', { query: 'q_featured_posts', inPlace: true, params: [{ name: 'limit', type: 'boolean', default: true }] }, 'invalid')
  })
})

describe('a return-only action returns on every run, and with what its output takes', () => {
  it('a condition that depends on the input could fall through the end of the use-case', () => {
    project().refuse('action_update', { action: 'act_publish_post', steps: [{ kind: 'return', if: { $input: 'id' }, value: { $var: 'undefined' } }] }, 'invalid')
  })

  it('a return that never runs, on an action that deletes nothing', () => {
    const p = project()
    p.edit('action_create', { entity: 'ent_post', template: 'delete', name: 'removePost' })
    p.refuse('action_update', { action: 'act_remove_post', steps: [{ kind: 'return', if: false, value: { $var: 'undefined' } }] }, 'invalid')
  })

  it('"undefined" for an action whose output is an entity', () => {
    project().refuse('action_update', { action: 'act_publish_post', steps: [{ kind: 'return', if: true, value: { $var: 'undefined' } }] }, 'invalid')
  })

  it('a step after a return that always runs is never reached', () => {
    const p = project()
    p.edit('action_create', { entity: 'ent_post', template: 'blank', name: 'tidyPosts' })
    p.refuse('action_update', {
      action: 'act_tidy_posts',
      steps: [{ kind: 'return', if: true, value: { $var: 'undefined' } }, { kind: 'repository', repository: 'repo_post', op: 'delete', id: { $input: 'id' } }]
    }, 'invalid')
  })

  it('still takes a blank action and a return that always runs', () => {
    const p = project()
    p.edit('action_create', { entity: 'ent_post', template: 'blank', name: 'tidyPosts' })
    p.edit('action_update', { action: 'act_tidy_posts', steps: [{ kind: 'return', if: true, value: { $var: 'undefined' } }] })
  })
})

describe('action_update', () => {
  it('refuses a params-only input on a blank action, which has nothing to invalidate, with a reason (not a crash)', () => {
    const p = project()
    p.edit('action_create', { entity: 'ent_post', template: 'blank', name: 'tidyPosts' })
    const outcome = p.refuse('action_update', { action: 'act_tidy_posts', input: { params: [{ name: 'id', type: 'uuid', from: 'route' }] } }, 'invalid')
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.message).not.toContain('Cannot read properties')
  })

  it('refuses two dynamic routes at the same level that answer one method: DELETE /posts/:id and /posts/:slug', () => {
    const p = project()
    p.edit('action_create', { entity: 'ent_post', template: 'delete', name: 'removePost' })
    p.edit('action_create', { entity: 'ent_post', template: 'blank', name: 'tidyPosts' })
    p.refuse('action_update', { action: 'act_tidy_posts', http: { method: 'DELETE', path: '/posts/:slug' } }, 'invalid')
  })
})
