// B7 verification: an action that takes no input can't have steps that read $input (the generated use-case has no `input`).
import { describe, expect, it } from 'vitest'
import { project } from './helpers'

describe('an action with no input reads no $input', () => {
  it('taking the input from a delete action whose step reads $input.id is refused', () => {
    const p = project()
    p.edit('action_create', { entity: 'ent_post', template: 'delete', name: 'dropPost' })
    expect(p.refuse('action_update', { action: 'act_drop_post', input: {}, http: { path: '/posts/drop' }, client: { invalidates: ['ent_post'] } }, 'invalid').message).toMatch(/takes no input/)
  })

  it('a step reading $input on an action already without input is refused, in two edits', () => {
    const p = project()
    p.edit('action_create', { entity: 'ent_post', template: 'blank', name: 'sweepPosts' })
    p.edit('action_update', { action: 'act_sweep_posts', input: {} })
    expect(p.refuse('action_update', { action: 'act_sweep_posts', steps: [{ kind: 'return', if: { $input: 'title' }, value: { $var: 'undefined' } }, { kind: 'return', if: true, value: { $var: 'undefined' } }] }, 'invalid').message).toMatch(/takes no input/)
  })

  it('and in one edit', () => {
    const p = project()
    p.edit('action_create', { entity: 'ent_post', template: 'blank', name: 'mopPosts' })
    expect(p.refuse('action_update', { action: 'act_mop_posts', input: {}, steps: [{ kind: 'return', if: { $input: 'title' }, value: { $var: 'undefined' } }, { kind: 'return', if: true, value: { $var: 'undefined' } }] }, 'invalid').message).toMatch(/takes no input/)
  })
})
