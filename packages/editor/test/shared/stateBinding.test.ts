import { describe, expect, it } from 'vitest'
import { loadModel } from '@bildr/codegen/model'
import type { Model } from '@bildr/codegen/model'
import { stateChip, stateChoiceNow, stateChoices, statePropExpect } from '../../src/shared/stateBinding.ts'
import { blogModelFiles } from '../canvas/fixture.ts'

/**
 * What a prop can bind to State (B4, S3): the module's states and their fields, typed for the prop, whether the page uses the state
 * yet or not; the name the page would read it under; and how a bound field reads on a chip. Read against the blog fixture: its
 * index page uses the state `preferences` (Blog preferences, one boolean `showDrafts`), its new-post page does not.
 */

const loaded = loadModel(blogModelFiles())
if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
const model: Model = loaded.model

describe('statePropExpect', () => {
  it('takes true or false for a Checkbox\'s value and text or a number for the text a node shows, and nothing for the other props', () => {
    expect(statePropExpect('Checkbox', 'value')).toEqual({ prims: ['boolean'] })
    expect(statePropExpect('Heading', 'text')?.prims).toEqual(['string', 'number'])
    expect(statePropExpect('Image', 'src')?.prims).toEqual(['string'])
    expect(statePropExpect('Checkbox', 'label')).toBeUndefined()
    expect(statePropExpect('List', 'items')).toBeUndefined()
  })

  it('takes no State for the value of a Checkbox that fills a Form field: the Form gives it its value', () => {
    expect(statePropExpect('Checkbox', 'value', { label: 'Flag', field: 'done' })).toBeUndefined()
    expect(statePropExpect('Checkbox', 'value', { label: 'Flag' })).toEqual({ prims: ['boolean'] })
  })
})

describe('stateChoiceNow', () => {
  const place = { file: 'pg_new_post', kind: 'page' as const }
  const picked = () => stateChoices(model, place, { prims: ['boolean'] })[0]!

  it('is the choice as the page has it now: a use made since the menu was built is bound, not made again', () => {
    const stale = picked()
    expect(stale).toMatchObject({ alias: 'preferences', used: false })
    const copy = structuredClone(model)
    const page = copy.modules.blog!.pages.find(entry => entry.id === 'pg_new_post')!
    page.uses = { ...page.uses, state: [{ as: 'prefs', state: 'st_preferences' }] }
    expect(stateChoiceNow(copy, place, { prims: ['boolean'] }, stale)).toMatchObject({ alias: 'prefs', path: 'prefs.showDrafts', used: true })
  })

  it('is the name that is free now when another use took the one the menu offered', () => {
    const stale = picked()
    const copy = structuredClone(model)
    const page = copy.modules.blog!.pages.find(entry => entry.id === 'pg_new_post')!
    page.uses = { ...page.uses, queries: [...page.uses?.queries ?? [], { as: 'preferences', query: 'q_all_posts' }] }
    expect(stateChoiceNow(copy, place, { prims: ['boolean'] }, stale)).toMatchObject({ alias: 'preferences2', used: false })
  })

  it('is nothing when the field is gone', () => {
    const stale = picked()
    const copy = structuredClone(model)
    copy.modules.blog!.state[0]!.fields = []
    expect(stateChoiceNow(copy, place, { prims: ['boolean'] }, stale)).toBeUndefined()
  })
})

describe('stateChoices', () => {
  it('lists the state field a page already uses, under the name the page reads it by', () => {
    const choices = stateChoices(model, { file: 'pg_index', kind: 'page' }, { prims: ['boolean'] })
    expect(choices).toEqual([expect.objectContaining({ state: 'st_preferences', stateLabel: 'Blog preferences', field: 'showDrafts', alias: 'preferences', path: 'preferences.showDrafts', used: true })])
  })

  it('lists the field of a state the page does not use yet, to be added when it is picked', () => {
    const choices = stateChoices(model, { file: 'pg_new_post', kind: 'page' }, { prims: ['boolean'] })
    expect(choices).toEqual([expect.objectContaining({ state: 'st_preferences', field: 'showDrafts', alias: 'preferences', path: 'preferences.showDrafts', used: false })])
  })

  it('offers only the fields the prop takes', () => {
    expect(stateChoices(model, { file: 'pg_index', kind: 'page' }, { prims: ['string', 'number'] })).toEqual([])
  })

  it('offers nothing in a layout or a component: they cannot read State', () => {
    expect(stateChoices(model, { file: 'lay_main', kind: 'layout' }, { prims: ['boolean'] })).toEqual([])
    expect(stateChoices(model, { file: 'cmp_post_card', kind: 'component' }, { prims: ['boolean'] })).toEqual([])
  })

  it('leaves out a state of several rows, which is not generated yet', () => {
    const copy = structuredClone(model)
    copy.modules.blog!.state[0]!.shape = 'many'
    expect(stateChoices(copy, { file: 'pg_index', kind: 'page' }, { prims: ['boolean'] })).toEqual([])
  })

  it('leaves out a field that may be empty unless the prop takes that', () => {
    const copy = structuredClone(model)
    copy.modules.blog!.state[0]!.fields.push({ id: 'fld_note', name: 'note', type: 'text', nullable: true })
    expect(stateChoices(copy, { file: 'pg_index', kind: 'page' }, { prims: ['string'] })).toEqual([])
    expect(stateChoices(copy, { file: 'pg_index', kind: 'page' }, { prims: ['string'], null: true }).map(choice => choice.path)).toEqual(['preferences.note'])
  })
})

describe('stateChip', () => {
  it('reads a bound State field as "field · State label"', () => {
    expect(stateChip(model, 'pg_index', { $bind: 'preferences.showDrafts' })).toEqual({ alias: 'preferences', field: 'showDrafts', label: 'Blog preferences', text: 'showDrafts · Blog preferences' })
  })

  it('says nothing for a binding that is not a field of a state the page uses', () => {
    expect(stateChip(model, 'pg_index', { $bind: 'all.length' })).toBeUndefined()
    expect(stateChip(model, 'pg_index', { $bind: 'preferences' })).toBeUndefined()
    expect(stateChip(model, 'pg_new_post', { $bind: 'preferences.showDrafts' })).toBeUndefined()
    expect(stateChip(model, 'pg_index', 'plain')).toBeUndefined()
  })
})
