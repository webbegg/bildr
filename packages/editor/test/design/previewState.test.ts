import { describe, expect, it } from 'vitest'
import { loadModel } from '../../../codegen/src/model/load.ts'
import type { Model, ModelNode } from '@bildr/codegen/model'
import { designData } from '../../src/design/data.ts'
import { applySetState, previewIsEmpty, prunePreviewState } from '../../src/design/previewState.ts'
import { blogModelFiles } from '../canvas/fixture.ts'

/**
 * The canvas's preview state (B5, S5): the values a visitor of the preview sets on a State, kept by state id; the render data
 * every page that uses the State reads them from, the `setState` steps that set them, and what a model edit drops.
 */

const loaded = loadModel(blogModelFiles())
if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
const fresh = (): Model => structuredClone(loaded.model)
const model = fresh()
const blog = model.modules.blog!
const index = blog.pages.find(entry => entry.name === 'index')!
const newPost = blog.pages.find(entry => entry.name === 'posts-new')!
const step = (value: unknown, extra: Record<string, unknown> = {}) => ({ kind: 'setState', state: 'st_preferences', field: 'showDrafts', value, ...extra })
/** What the canvas reports: the step of the toggle's `change` (the golden page's own interaction) with its value worked out. */
const report = (value: unknown, extra: Record<string, unknown> = {}, at: { nodeId?: string, on?: string } = {}) => ({ nodeId: 'n_toggle', on: 'change', step: step(value, extra), ...at })
const find = (tree: ModelNode, id: string): ModelNode | undefined => tree.id === id ? tree : tree.children?.map(child => find(child, id)).find(Boolean)
const stateOf = (of: Model) => of.modules.blog!.state[0]!
const slugs = (rows: unknown) => (rows as Array<{ slug: string }>).map(row => row.slug)

describe('the render data of a page that uses a State', () => {
  it('holds the State\'s fields at their defaults, so a computed value reads them: the List shows the featured posts', () => {
    const data = designData(model, index)
    expect(data.preferences).toEqual({ showDrafts: false })
    expect(slugs(data.posts)).toEqual(slugs(data.featured))
    expect(slugs(data.posts)).not.toEqual(slugs(data.all))
  })

  it('overlays the values set in the preview on those defaults, and the computed value follows', () => {
    const data = designData(model, index, { state: { st_preferences: { showDrafts: true } } })
    expect(data.preferences).toEqual({ showDrafts: true })
    expect(slugs(data.posts)).toEqual(slugs(data.all))
    expect(data.posts).toBe(data.all)
  })

  it('gives the same value to every page that uses the State: it is keyed by the State, not by the page', () => {
    const other = structuredClone(newPost)
    other.uses = { ...other.uses, state: [{ as: 'prefs', state: 'st_preferences' }] }
    expect(designData(model, other, { state: { st_preferences: { showDrafts: true } } }).prefs).toEqual({ showDrafts: true })
  })

  it('leaves a page alone that does not use the State', () => {
    expect(designData(model, newPost, { state: { st_preferences: { showDrafts: true } } }).preferences).toBeUndefined()
  })

  it('ignores a value for a field the State no longer has', () => {
    expect(designData(model, index, { state: { st_preferences: { gone: 1, showDrafts: true } } }).preferences).toEqual({ showDrafts: true })
  })
})

describe('Set state in the preview', () => {
  it('sets the field of the State, merging with what is set', () => {
    expect(applySetState(model, index, {}, report(true))).toEqual({ st_preferences: { showDrafts: true } })
    expect(applySetState(model, index, { st_preferences: { showDrafts: true } }, report(false))).toEqual({ st_preferences: { showDrafts: false } })
  })

  it('keeps what it is given: a new value, never a change in place', () => {
    const before = { st_preferences: { showDrafts: true } }
    const after = applySetState(model, index, before, report(false))
    expect(before).toEqual({ st_preferences: { showDrafts: true } })
    expect(after).not.toBe(before)
  })

  it('refuses what it cannot apply, and returns the values as they were', () => {
    const before = { st_preferences: { showDrafts: true } }
    const refused = [
      report('yes'), // a text for a Boolean
      report(undefined),
      report({ $event: 'checked' }), // not resolved: the canvas resolves it
      report(true, { field: 'gone' }),
      report(true, { field: 'constructor' }),
      report(true, { state: 'st_gone' }),
      report(true, { kind: 'toast' }),
      report(true, { field: 3 })
    ]
    for (const entry of refused) expect(applySetState(model, index, before, entry)).toBe(before)
  })

  it('applies only a step the reported node really has, for that event: the node, the event, the State and the field must match', () => {
    const before = { st_preferences: { showDrafts: true } }
    const two = fresh()
    two.modules.blog!.state[0]!.fields.push({ id: 'fld_other', name: 'other', type: 'boolean' })
    const page = two.modules.blog!.pages.find(entry => entry.name === 'index')!
    for (const entry of [
      report(false, {}, { nodeId: 'n_h1' }), // a node with no interaction
      report(false, {}, { nodeId: 'n_gone' }), // a node that is not there
      report(false, {}, { on: 'click' }), // an event the node does not run this step for
      report(false, { field: 'other' }) // a field of the State this node's step does not set
    ]) expect(applySetState(two, page, before, entry)).toBe(before)
    expect(applySetState(two, page, before, report(false))).toEqual({ st_preferences: { showDrafts: false } })
  })

  it('refuses a text longer than 10 000 characters, and takes one of 10 000', () => {
    const typed = fresh()
    typed.modules.blog!.state[0]!.fields = [{ id: 'fld_t', name: 'title', type: 'text' }]
    const page = structuredClone(typed.modules.blog!.pages.find(entry => entry.name === 'index')!)
    find(page.root, 'n_toggle')!.interactions = [{ on: 'change', do: [step('', { field: 'title' })] }] as never
    const set = (value: string) => applySetState(typed, page, {}, report(value, { field: 'title' }))
    expect(set('x'.repeat(10_000))).toEqual({ st_preferences: { title: 'x'.repeat(10_000) } })
    expect(set('x'.repeat(10_001))).toEqual({})
  })

  it('does nothing for a State the page does not use', () => {
    const before = {}
    expect(applySetState(model, newPost, before, report(true))).toBe(before)
    // A layout or a component being edited has no page to set a State of: its preview sets nothing.
    expect(applySetState(model, undefined, before, report(true))).toBe(before)
  })

  it('checks the value against the field\'s type', () => {
    const typed = fresh()
    const state = typed.modules.blog!.state[0]!
    state.fields = [
      { id: 'fld_n', name: 'count', type: 'integer' },
      { id: 'fld_t', name: 'title', type: 'text' },
      { id: 'fld_r', name: 'ratio', type: 'number' },
      { id: 'fld_o', name: 'note', type: 'text', nullable: true },
      { id: 'fld_q', name: 'must', type: 'text', required: true }
    ]
    const page = structuredClone(typed.modules.blog!.pages.find(entry => entry.name === 'index')!)
    find(page.root, 'n_toggle')!.interactions = [{ on: 'change', do: stateOf(typed).fields.map(field => step('', { field: field.name })) }] as never
    const set = (field: string, value: unknown) => applySetState(typed, page, {}, report(value, { field }))
    expect(set('count', 3)).toEqual({ st_preferences: { count: 3 } })
    expect(set('count', 2.5)).toEqual({})
    expect(set('count', '3')).toEqual({})
    expect(set('ratio', 2.5)).toEqual({ st_preferences: { ratio: 2.5 } })
    expect(set('ratio', Number.NaN)).toEqual({})
    expect(set('title', 'Hi')).toEqual({ st_preferences: { title: 'Hi' } })
    expect(set('title', 4)).toEqual({})
    // Null is for a nullable field only, as the module's own check of the step says.
    expect(set('note', null)).toEqual({ st_preferences: { note: null } })
    expect(set('must', null)).toEqual({})
    expect(set('title', null)).toEqual({})
  })
})

describe('what a model edit drops from the preview values', () => {
  const values = { st_preferences: { showDrafts: true }, st_other: { x: 1 } }

  it('keeps values that still fit, and the same object when nothing was dropped', () => {
    const kept = { st_preferences: { showDrafts: true } }
    expect(prunePreviewState(model, kept)).toBe(kept)
  })

  it('drops the values of a State that was deleted', () => {
    expect(prunePreviewState(model, values)).toEqual({ st_preferences: { showDrafts: true } })
  })

  it('drops the value of a field that was removed or renamed', () => {
    const renamed = fresh()
    renamed.modules.blog!.state[0]!.fields[0]!.name = 'showAll'
    expect(prunePreviewState(renamed, { st_preferences: { showDrafts: true } })).toEqual({})
    const removed = fresh()
    removed.modules.blog!.state[0]!.fields.push({ id: 'fld_x', name: 'extra', type: 'text' })
    removed.modules.blog!.state[0]!.fields.shift()
    expect(prunePreviewState(removed, { st_preferences: { showDrafts: true, extra: 'x' } })).toEqual({ st_preferences: { extra: 'x' } })
  })

  it('drops the value of a field whose type changed to one it no longer fits', () => {
    const changed = fresh()
    changed.modules.blog!.state[0]!.fields[0]!.type = 'integer'
    expect(prunePreviewState(changed, { st_preferences: { showDrafts: true } })).toEqual({})
  })

  it('drops an empty entry, and says so by returning new values', () => {
    expect(prunePreviewState(model, { st_preferences: {} })).toEqual({})
    expect(prunePreviewState(model, {})).toEqual({})
  })

  it('says whether there is anything to reset', () => {
    expect(previewIsEmpty({})).toBe(true)
    expect(previewIsEmpty({ st_preferences: {} })).toBe(true)
    expect(previewIsEmpty(values)).toBe(false)
  })
})
