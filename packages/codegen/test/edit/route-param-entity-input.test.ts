// fix/route-param-entity-input: an action can't take both a route parameter and a collection (entity) input. The generated
// route, use-case and client composable each take one of them (a body, or the parameter), so `useTidyNotes.ts` read an `id` it never
// had and the server route parsed one it never used: the app didn't typecheck or lint. The model refuses the combination.
import { describe, expect, it } from 'vitest'
import { generate } from '../../src/generate/index'
import { loadModel } from '../../src/model/load'
import { fixtureModelFiles } from '../model/fixture'
import { project } from './helpers'

const MESSAGE = 'An action takes a collection input (a body) or route parameters, not both: its client composable, route and use-case take one of them. Pass the id in the entity input (pick it), or drop the input and keep the route parameter'

const withNote = () => {
  const p = project()
  p.edit('datasource_create', { name: 'scratch', kind: 'memory' })
  p.edit('entity_create', { name: 'note', source: 'ds_scratch', fields: [{ name: 'title', type: 'text', required: true }] })
  p.edit('action_create', { entity: 'ent_note', template: 'blank', name: 'tidyNotes' })
  return p
}

describe('an action with a route parameter and a collection input', () => {
  it('is refused by action_update, with the reason, and nothing changes', () => {
    const p = withNote()
    const before = p.files
    const refusal = p.refuse('action_update', {
      action: 'act_tidy_notes',
      http: { path: '/notes/:id/tidy' },
      input: { entity: 'ent_note', pick: ['id', 'title'], params: [{ name: 'id', type: 'uuid', from: 'route' }] }
    }, 'invalid')
    expect(refusal.message).toContain(MESSAGE)
    expect(p.files).toBe(before)
  })

  it('is refused whichever edit makes it: the parameters added to an action with an entity input', () => {
    const p = withNote()
    p.edit('action_update', { action: 'act_tidy_notes', http: { path: '/notes/:id/tidy' } })
    expect(p.refuse('action_update', { action: 'act_tidy_notes', input: { entity: 'ent_note', params: [{ name: 'id', type: 'uuid', from: 'route' }] } }, 'invalid').message).toContain(MESSAGE)
  })

  it('is refused by the model when a file holds it (a hand-edited action)', () => {
    const files = fixtureModelFiles()
    const path = '.bildr/modules/blog/actions/publish-post.json'
    const action = JSON.parse(files[path]!) as { input: Record<string, unknown> }
    action.input = { entity: 'ent_post', params: [{ name: 'id', type: 'uuid', from: 'route' }] }
    const loaded = loadModel({ ...files, [path]: JSON.stringify(action) })
    expect(loaded.ok).toBe(false)
    if (!loaded.ok) expect(loaded.problems).toEqual([{ path, message: `input: ${MESSAGE}` }])
  })

  it('leaves each shape alone: params only, entity input only, no input', () => {
    const p = withNote()
    p.edit('action_update', { action: 'act_tidy_notes', http: { path: '/notes/:id/tidy' }, input: { params: [{ name: 'id', type: 'uuid', from: 'route' }] } })
    p.edit('action_update', { action: 'act_tidy_notes', input: { entity: 'ent_note', pick: ['id', 'title'] } })
    p.edit('action_update', { action: 'act_tidy_notes', input: {} })
    const loaded = loadModel(p.files)
    expect(loaded.ok).toBe(true)
    if (loaded.ok) expect(() => generate(loaded.model)).not.toThrow()
  })

  it('refuses no template and no fixture: every action they have takes one shape', () => {
    const loaded = loadModel(fixtureModelFiles())
    expect(loaded.ok).toBe(true)
    const note = withNote()
    // The update template needs a sample row; the create template the route /posts, which act_create_post holds.
    const p = project({ ...note.files, '.bildr/modules/blog/fixtures/note.json': JSON.stringify({ entity: 'ent_note', rows: [{ id: '0b6f6a52-1c7a-4c1e-9a52-7a0e2f3d9a77', title: 'Hi' }] }) })
    p.edit('action_update', { action: 'act_create_post', http: { path: '/posts/legacy' } })
    for (const template of ['create', 'delete', 'blank']) p.edit('action_create', { entity: 'ent_post', template, name: `${template}Posts` })
    for (const template of ['update', 'delete']) p.edit('action_create', { entity: 'ent_note', template, name: `${template}Note` })
    const model = p.model()
    for (const action of Object.values(model.modules).flatMap(mod => mod.actions)) expect(Boolean(action.input.entity && action.input.params?.length), action.id).toBe(false)
  })
})
