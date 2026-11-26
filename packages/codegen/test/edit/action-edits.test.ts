import { describe, expect, it } from 'vitest'
import { generate } from '../../src/generate/index'
import { IDX, project } from './helpers'
import type { Json } from './helpers'

/** D10a (S10): actions as first-class artifacts: templates, partial updates, rename and delete. */

const ACTIONS = '.bildr/modules/blog/actions'

/** The model loads and the whole app generates; returns the generated files by path. */
const generated = (p: ReturnType<typeof project>) => Object.fromEntries(generate(p.model()).map(file => [file.path, file.content]))

/** An entity `tag` over the app database, with one sample row: what an update's generated test loads. */
const withTag = () => {
  const p = project()
  p.edit('entity_create', { name: 'tag', source: 'ds_main', fields: [{ name: 'label', type: 'text', required: true }] })
  p.edit('action_delete', { action: 'act_create_tag' })
  return project({ ...p.files, '.bildr/modules/blog/fixtures/tag.json': JSON.stringify({ entity: 'ent_tag', rows: [{ id: '0b6f6a52-1c7a-4c1e-9a52-7a0e2f3d9a88', label: 'news' }] }) })
}

/** A REST entity with only list and get: its key is an integer, and it can't write. */
const withAuthor = () => {
  const p = project()
  p.edit('entity_create', {
    name: 'author', source: 'ds_quotes', fields: [{ name: 'id', type: 'integer' }, { name: 'name', type: 'text' }],
    endpoints: { list: { path: '/authors', itemsPath: 'authors' }, get: { path: '/authors/:id' } }
  })
  return p
}

describe('action_create: create', () => {
  it('is what entity_create writes for act_create_<name>, byte for byte', () => {
    const p = project()
    p.edit('entity_create', { name: 'tag', source: 'ds_main', fields: [{ name: 'label', type: 'text', required: true }] })
    const path = `${ACTIONS}/create-tag.json`
    const made = p.files[path]!
    p.edit('action_delete', { action: 'act_create_tag' })
    expect(p.files[path]).toBeUndefined()
    const out = p.edit('action_create', { entity: 'ent_tag', template: 'create', name: 'createTag' })
    expect(out).toMatchObject({ actionId: 'act_create_tag', filePath: path })
    expect(p.files[path]).toBe(made)
    expect(Object.keys(generated(p))).toContain('layers/blog/server/application/actions/create-tag.ts')
  })

  it('takes the name and label it is given, and an external key stays in the input', () => {
    const p = project()
    p.edit('entity_create', { name: 'tag', source: 'ds_main', fields: [{ name: 'label', type: 'text' }] })
    p.edit('action_delete', { action: 'act_create_tag' })
    p.edit('action_create', { entity: 'ent_tag', template: 'create', name: 'addTag', label: 'Add a tag' })
    expect(p.json(`${ACTIONS}/add-tag.json`)).toMatchObject({
      id: 'act_add_tag', name: 'addTag', label: 'Add a tag', http: { method: 'POST', path: '/tags' },
      input: { entity: 'ent_tag', pick: ['id', 'label'] }, output: { entity: 'ent_tag' },
      steps: [{ kind: 'validate' }, { kind: 'repository', repository: 'repo_tag', op: 'create' }],
      client: { optimistic: { kind: 'insert', entity: 'ent_tag' }, invalidates: ['ent_tag'] }
    })
    generated(p)
  })
})

describe('action_create: update and delete', () => {
  it('update: PATCH /<plural>/:id loads the row by id, writes it back, and generates', () => {
    const p = withTag()
    const out = p.edit('action_create', { entity: 'ent_tag', template: 'update', name: 'updateTag' })
    expect(out).toMatchObject({ actionId: 'act_update_tag', filePath: `${ACTIONS}/update-tag.json` })
    expect(p.json(`${ACTIONS}/update-tag.json`)).toEqual({
      id: 'act_update_tag', name: 'updateTag', label: 'Update tag',
      http: { method: 'PATCH', path: '/tags/:id' },
      input: { params: [{ name: 'id', type: 'uuid', from: 'route' }] },
      output: { entity: 'ent_tag' },
      errors: [{ type: 'tag_not_found', status: 404, message: 'Tag not found.', data: { id: 'text' } }],
      steps: [
        { kind: 'load', as: 'existing', repository: 'repo_tag', op: 'get', args: { id: { $input: 'id' } }, orError: 'tag_not_found', errorData: { id: { $input: 'id' } } },
        { kind: 'repository', repository: 'repo_tag', op: 'update', id: { $input: 'id' }, from: { $var: 'existing' } }
      ],
      client: { invalidates: ['ent_tag'] }
    })
    const files = generated(p)
    expect(files['layers/blog/server/api/blog/tags/[id].patch.ts']).toContain('getRouterParam(event, \'id\')')
    expect(files['layers/blog/server/application/actions/update-tag.ts']).toContain('tags.update(id, { ...existing })')
    expect(files['layers/blog/app/composables/blog/useUpdateTag.ts']).toContain('method: updateTagContract.method')
    expect(files['layers/blog/shared/contracts/update-tag.ts']).toContain('method: \'PATCH\'')
  })

  it('update is refused for an entity with timestamps, which the generator can\'t stamp from an update that sets nothing', () => {
    expect(project().refuse('action_create', { entity: 'ent_post', template: 'update', name: 'updatePost' }, 'invalid').message)
      .toBe('Update isn\'t generated yet for entities with timestamps (Post): its stamp needs a field set to { "$now": true }. Use blank and write the steps, or turn timestamps off')
  })

  it('delete: DELETE /<plural>/:id removes the row by id, with an optimistic delete, and generates', () => {
    const p = project()
    p.edit('action_create', { entity: 'ent_post', template: 'delete', name: 'removePost', label: 'Remove a post' })
    expect(p.json(`${ACTIONS}/remove-post.json`)).toEqual({
      id: 'act_remove_post', name: 'removePost', label: 'Remove a post',
      http: { method: 'DELETE', path: '/posts/:id' },
      input: { params: [{ name: 'id', type: 'uuid', from: 'route' }] },
      errors: [],
      steps: [{ kind: 'repository', repository: 'repo_post', op: 'delete', id: { $input: 'id' } }],
      client: { optimistic: { kind: 'delete', entity: 'ent_post', key: { $input: 'id' } }, invalidates: ['ent_post'] }
    })
    const files = generated(p)
    expect(files['layers/blog/server/api/blog/posts/[id].delete.ts']).toBeDefined()
    expect(files['layers/blog/server/application/actions/remove-post.ts']).toContain('posts.delete(id)')
    expect(files['layers/blog/app/composables/blog/useRemovePost.ts']).toContain('postsCollection.delete(id)')
  })

  it('works over a memory entity once it has a sample row, and update says so before then', () => {
    const p = project()
    p.edit('datasource_create', { name: 'scratch', kind: 'memory' })
    p.edit('entity_create', { name: 'note', source: 'ds_scratch', fields: [{ name: 'text', type: 'text' }] })
    p.edit('action_create', { entity: 'ent_note', template: 'delete', name: 'removeNote' })
    expect(p.refuse('action_create', { entity: 'ent_note', template: 'update', name: 'updateNote' }, 'invalid').message)
      .toBe('Update needs a sample row of Note: its generated test loads one. Add sample data to Note first')
    // (the memory source's sample data file starts empty)
    const seeded = project({ ...p.files, '.bildr/modules/blog/fixtures/note.json': JSON.stringify({ entity: 'ent_note', rows: [{ id: '0b6f6a52-1c7a-4c1e-9a52-7a0e2f3d9a77', text: 'Hi' }] }) })
    seeded.edit('action_create', { entity: 'ent_note', template: 'update', name: 'updateNote' })
    generated(seeded)
  })

  it('refuses update and delete where the generator can\'t route the key (not a uuid), and operations the source lacks', () => {
    const p = withAuthor()
    expect(p.refuse('action_create', { entity: 'ent_author', template: 'update', name: 'updateAuthor' }, 'invalid').message)
      .toBe('Author can\'t be updated: its repository has no update operation')
    expect(p.refuse('action_create', { entity: 'ent_author', template: 'delete', name: 'removeAuthor' }, 'invalid').message)
      .toBe('Author can\'t be deleted: its repository has no delete operation')
    expect(p.refuse('action_create', { entity: 'ent_author', template: 'create', name: 'addAuthor' }, 'invalid').message)
      .toBe('Author can\'t be created: its repository has no create operation')
    // A REST entity that can write, but whose key is an integer: the generated routes take uuid keys only.
    const q = project()
    q.edit('entity_create', {
      name: 'book', source: 'ds_quotes', fields: [{ name: 'id', type: 'integer' }, { name: 'title', type: 'text' }],
      endpoints: { list: { path: '/books', itemsPath: 'books' }, get: { path: '/books/:id' }, update: { path: '/books/:id' }, delete: { path: '/books/:id' } }
    })
    expect(q.refuse('action_create', { entity: 'ent_book', template: 'delete', name: 'removeBook' }, 'invalid').message)
      .toBe('Book has an integer key: generated routes take uuid keys only, so it can\'t be deleted from an action yet')
    expect(q.refuse('action_create', { entity: 'ent_book', template: 'update', name: 'updateBook' }, 'invalid').message)
      .toBe('Book has an integer key: generated routes take uuid keys only, so it can\'t be updated from an action yet')
  })

  it('refuses a second action on the same method and path, naming the first', () => {
    const p = project()
    p.edit('action_create', { entity: 'ent_post', template: 'delete', name: 'removePost' })
    expect(p.refuse('action_create', { entity: 'ent_post', template: 'delete', name: 'dropPost' }, 'invalid').message)
      .toBe('The action act_remove_post already answers DELETE /posts/:id')
    expect(p.refuse('action_create', { entity: 'ent_post', template: 'create', name: 'makePost' }, 'invalid').message)
      .toBe('The action act_create_post already answers POST /posts')
  })
})

describe('action_create: blank', () => {
  it('starts with one return step, and validates and generates', () => {
    const p = project()
    const out = p.edit('action_create', { entity: 'ent_post', template: 'blank', name: 'recount', label: 'Recount posts' })
    expect(out.actionId).toBe('act_recount')
    const action = p.json(`${ACTIONS}/recount.json`)
    expect(action).toMatchObject({ name: 'recount', label: 'Recount posts', http: { method: 'POST', path: '/posts/recount' }, input: { entity: 'ent_post' }, errors: [], client: { invalidates: [] } })
    expect(action.steps).toEqual([{ kind: 'return', if: true, value: { $var: 'undefined' } }])
    expect(action.output).toBeUndefined()
    const files = generated(p)
    // A return that always runs is a plain return (`if (true)` fails the project's lint); nothing it reads is named `input`.
    expect(files['layers/blog/server/application/actions/recount.ts']).toContain('return ok(undefined)')
    expect(files['layers/blog/server/application/actions/recount.ts']).not.toContain('if (true)')
    expect(files['layers/blog/server/application/actions/recount.ts']).toContain('async (_input: NewPost)')
    expect(files['layers/blog/server/api/blog/posts/recount.post.ts']).toBeDefined()
    expect(files['layers/blog/app/composables/blog/useRecount.ts']).toBeDefined()
  })

  it('works over a sqlite and a memory entity, and is refused over a read-only one (no input to take)', () => {
    const p = project()
    p.edit('datasource_create', { name: 'scratch', kind: 'memory' })
    p.edit('entity_create', { name: 'note', source: 'ds_scratch', fields: [{ name: 'text', type: 'text' }] })
    p.edit('action_create', { entity: 'ent_note', template: 'blank', name: 'tidy' })
    generated(p)
    expect(withAuthor().refuse('action_create', { entity: 'ent_author', template: 'blank', name: 'sync' }, 'invalid').message)
      .toBe('Author is read-only: its repository has no create, update or delete operation, so an action over it has nothing to take or do')
  })

  it('an action whose last step is a return that always runs is valid; one with neither a repository step nor that is still refused', () => {
    const p = project()
    p.edit('action_create', { entity: 'ent_post', template: 'blank', name: 'recount' })
    const steps = (list: unknown) => ({ action: 'act_recount', steps: list })
    p.refuse('action_update', steps([{ kind: 'validate' }]), 'invalid')
    p.edit('action_update', steps([{ kind: 'validate' }, { kind: 'return', if: true, value: { $var: 'undefined' } }]))
  })
})

describe('action_create refusals', () => {
  it('refuses a bad name, a taken one (any case, queries and actions) and a reserved word', () => {
    const p = project()
    const make = (name: string) => p.refuse('action_create', { entity: 'ent_post', template: 'blank', name }, 'invalid').message
    expect(make('9lives')).toMatch(/can't be an action name/)
    expect(make('createPost')).toBe('Module "blog" already has the action createPost (act_create_post)')
    expect(make('CREATEPOST')).toMatch(/already has the action createPost/)
    expect(make('allPosts')).toBe('Module "blog" already has the query allPosts (q_all_posts)')
    expect(make('new')).toMatch(/reserved word/)
    expect(make('listPosts')).toMatch(/name of the generated list use-case of Post/)
    p.refuse('action_create', { entity: 'ent_post', template: 'blank', name: '' }, 'invalid_input')
  })

  it('refuses an unknown entity, an unknown template and a module that isn\'t the entity\'s', () => {
    const p = project()
    p.refuse('action_create', { entity: 'ent_nope', template: 'blank', name: 'x' }, 'not_found')
    p.refuse('action_create', { entity: 'ent_post', template: 'nope', name: 'x' }, 'invalid_input')
    p.refuse('action_create', { module: 'nope', entity: 'ent_post', template: 'blank', name: 'x' }, 'not_found')
  })
})

describe('action_update', () => {
  const update = (p: ReturnType<typeof project>, input: Json) => p.edit('action_update', { action: 'act_publish_post', ...input })

  it('changes the label, description and http partially, and null removes the description', () => {
    const p = project()
    expect(update(p, { label: 'Publish it', description: 'Makes it public.', http: { path: '/posts/:id/release' } })).toMatchObject({ actionId: 'act_publish_post' })
    expect(p.json(`${ACTIONS}/publish-post.json`)).toMatchObject({ label: 'Publish it', description: 'Makes it public.', http: { method: 'POST', path: '/posts/:id/release' } })
    update(p, { description: null })
    expect(p.json(`${ACTIONS}/publish-post.json`)).not.toHaveProperty('description')
    expect(Object.keys(generated(p))).toContain('layers/blog/server/api/blog/posts/[id]/release.post.ts')
  })

  it('replaces input, steps, errors and client whole, and the model still generates', () => {
    const p = withTag()
    p.edit('action_create', { entity: 'ent_tag', template: 'update', name: 'updateTag' })
    p.edit('action_update', {
      action: 'act_update_tag',
      errors: [{ type: 'gone', status: 410, message: 'This tag is gone.' }, { type: 'tag_not_found', status: 404, message: 'Tag not found.', data: { id: 'text' } }],
      steps: [
        { kind: 'load', as: 'existing', repository: 'repo_tag', op: 'get', args: { id: { $input: 'id' } }, orError: 'tag_not_found', errorData: { id: { $input: 'id' } } },
        { kind: 'repository', repository: 'repo_tag', op: 'update', id: { $input: 'id' }, from: { $var: 'existing' }, set: { label: 'archived' } }
      ],
      client: { invalidates: ['ent_tag'], optimistic: { kind: 'update', entity: 'ent_tag', key: { $input: 'id' }, set: { label: 'archived' } } }
    })
    const action = p.json(`${ACTIONS}/update-tag.json`)
    expect(action.errors.map((error: Json) => error.type)).toEqual(['gone', 'tag_not_found'])
    expect(action.steps[1].set).toEqual({ label: 'archived' })
    expect(action.client.optimistic).toMatchObject({ kind: 'update' })
    expect(generated(p)['layers/blog/server/application/actions/update-tag.ts']).toContain('{ ...existing, label: \'archived\' }')
  })

  it('refuses what the model or the generator refuses, and says which', () => {
    const p = project()
    p.refuse('action_update', { action: 'act_nope', label: 'x' }, 'not_found')
    p.refuse('action_update', { action: 'act_publish_post', steps: [] }, 'invalid_input')
    p.refuse('action_update', { action: 'act_publish_post', label: '' }, 'invalid_input')
    // The model: an unknown entity, a step with no repository work, a repository step not last.
    expect(p.refuse('action_update', { action: 'act_publish_post', input: { entity: 'ent_nope' } }, 'invalid').message).toMatch(/Unknown entity "ent_nope"/)
    expect(p.refuse('action_update', { action: 'act_publish_post', steps: [{ kind: 'return', if: true, value: { $var: 'post' } }, { kind: 'repository', repository: 'repo_post', op: 'delete', id: { $input: 'id' } }, { kind: 'return', if: true, value: { $var: 'post' } }] }, 'invalid').message).toMatch(/must be the last step/)
    // The generator: a step kind it doesn't generate, an error a step names but the action doesn't declare.
    expect(p.refuse('action_update', { action: 'act_publish_post', steps: [{ kind: 'custom' }, { kind: 'repository', repository: 'repo_post', op: 'delete', id: { $input: 'id' } }] }, 'invalid').message).toMatch(/not generated yet/)
    expect(p.refuse('action_update', { action: 'act_publish_post', errors: [] }, 'invalid').message).toMatch(/post_not_found/)
    // Input fields the entity doesn't have; a route another action already answers.
    expect(p.refuse('action_update', { action: 'act_create_post', input: { entity: 'ent_post', pick: ['id', 'nope'] } }, 'invalid').message).toBe('input: Post has no field "nope"')
    expect(p.refuse('action_update', { action: 'act_publish_post', http: { path: '/posts' } }, 'invalid').message).toBe('The action act_create_post already answers POST /posts')
  })

  it('refuses taking the entity input away from an action a Form runs', () => {
    const p = project()
    expect(p.refuse('action_update', { action: 'act_create_post', http: { path: '/posts/:id' }, input: { params: [{ name: 'id', type: 'uuid', from: 'route' }] }, steps: [{ kind: 'repository', repository: 'repo_post', op: 'delete', id: { $input: 'id' } }] }, 'invalid').message)
      .toBe('The edit would leave a model the generator can\'t build: .bildr/modules/blog/pages/new-post.json (node n_form): a Form needs an action with an entity input')
  })
})

describe('action_rename', () => {
  it('changes the name only: ids and the aliases pages and forms hold stay, and the model generates', () => {
    const p = project()
    const before = p.json('.bildr/modules/blog/pages/new-post.json')
    const out = p.edit('action_rename', { action: 'act_create_post', name: 'addPost' })
    expect(out).toMatchObject({ actionId: 'act_create_post', name: 'addPost', previousName: 'createPost', composable: 'useAddPost', previousComposable: 'useCreatePost' })
    expect(out.changes.map((change: { path: string }) => change.path)).toEqual([`${ACTIONS}/create-post.json`])
    expect(p.json(`${ACTIONS}/create-post.json`)).toMatchObject({ id: 'act_create_post', name: 'addPost' })
    expect(p.json('.bildr/modules/blog/pages/new-post.json')).toEqual(before)
    const files = generated(p)
    expect(files['layers/blog/app/composables/blog/useAddPost.ts']).toBeDefined()
    expect(files['layers/blog/app/composables/blog/useCreatePost.ts']).toBeUndefined()
    expect(files['layers/blog/server/application/actions/add-post.ts']).toContain('export const addPost =')
  })

  it('refuses a taken name (an action or a query, any case), a bad one and an unknown action', () => {
    const p = project()
    expect(p.refuse('action_rename', { action: 'act_create_post', name: 'publishPost' }, 'invalid').message).toBe('Module "blog" already has the action publishPost (act_publish_post)')
    expect(p.refuse('action_rename', { action: 'act_create_post', name: 'ALLPOSTS' }, 'invalid').message).toBe('Module "blog" already has the query allPosts (q_all_posts)')
    expect(p.refuse('action_rename', { action: 'act_create_post', name: '1' }, 'invalid').message).toMatch(/can't be an action name/)
    p.refuse('action_rename', { action: 'act_nope', name: 'fine' }, 'not_found')
    expect(p.edit('action_rename', { action: 'act_create_post', name: 'createPost' }).changes).toEqual([])
  })
})

describe('action_delete', () => {
  it('deletes an unused action\'s file and the model still generates', () => {
    const p = project()
    p.edit('action_create', { entity: 'ent_post', template: 'blank', name: 'recount' })
    const out = p.edit('action_delete', { action: 'act_recount' })
    expect(out).toMatchObject({ deleted: ['act_recount'] })
    expect(out.changes).toEqual([{ path: `${ACTIONS}/recount.json`, content: null }])
    expect(Object.keys(generated(p))).not.toContain('layers/blog/server/application/actions/recount.ts')
  })

  it('is refused while a page uses it or a Form runs it, listing each with how', () => {
    const p = project()
    const message = p.refuse('action_delete', { action: 'act_create_post' }, 'invalid').message
    expect(message).toMatch(/^Action createPost \(act_create_post\) is still used: /)
    expect(message).toContain('page "posts-new" (pg_new_post) uses it as "createPost"')
    expect(message).toContain('page "posts-new" (pg_new_post): the Form n_form runs it')
    p.refuse('action_delete', { action: 'act_nope' }, 'not_found')
  })

  it('counts runAction interactions of any node, and works once the use is gone', () => {
    const files = project().files
    const page = JSON.parse(files[IDX]!) as Json
    page.root.children[0].interactions = [{ on: 'click', do: [{ kind: 'runAction', action: 'act_publish_post', args: { id: 'x' } }] }]
    const p = project({ ...files, [IDX]: JSON.stringify(page) })
    p.edit('page_create', { name: 'archive' })
    p.edit('page_use_add', { page: 'pg_archive', as: 'publisher', action: 'act_publish_post' })
    const message = p.refuse('action_delete', { action: 'act_publish_post' }, 'invalid').message
    expect(message).toContain('page "archive" (pg_archive) uses it as "publisher"')
    expect(message).toContain('page "index" (pg_index)')
    expect(message).toContain(' runs it on an interaction')
    p.edit('page_use_remove', { page: 'pg_archive', as: 'publisher' })
    expect(p.refuse('action_delete', { action: 'act_publish_post' }, 'invalid').message).not.toContain('pg_archive')
  })
})
