import { describe, expect, it } from 'vitest'
import { loadModel } from '@bildr/codegen/model'
import type { Model } from '@bildr/codegen/model'
import { allStates, stateById, stateFieldText, stateLabel, stateOfAlias, statesOfPage, useOfState } from '../../src/shared/stateModel.ts'
import { blogModelFiles } from '../canvas/fixture.ts'

/**
 * The one place the editor reads a model's State (B6): every State, one by id, a page's module's, a page's use of one, the State
 * behind a name the page reads, and how a State and its field are named. Read against the blog fixture: its index page uses the
 * state `preferences` (Blog preferences, one Toggle `showDrafts`), its new-post page does not.
 */

const loaded = loadModel(blogModelFiles())
if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
const model: Model = loaded.model
const blog = model.modules.blog!
const index = blog.pages.find(page => page.id === 'pg_index')!
const newPost = blog.pages.find(page => page.id === 'pg_new_post')!

describe('stateLabel', () => {
  it('is the label, and the name when there is none: never the id', () => {
    expect(stateLabel({ name: 'preferences', label: 'Blog preferences' })).toBe('Blog preferences')
    expect(stateLabel({ name: 'preferences' })).toBe('preferences')
    expect(stateLabel({ name: 'preferences', label: '' })).toBe('preferences')
  })
})

describe('the States of a model', () => {
  it('lists every state, and finds one by id', () => {
    expect(allStates(model).map(state => state.id)).toEqual(['st_preferences'])
    expect(stateById(model, 'st_preferences')?.name).toBe('preferences')
    expect(stateById(model, 'st_gone')).toBeUndefined()
  })

  it('lists the states of the module a page is in', () => {
    expect(statesOfPage(model, index).map(state => state.id)).toEqual(['st_preferences'])
    expect(statesOfPage(model, structuredClone(newPost)).map(state => state.id)).toEqual(['st_preferences'])
  })

  it('finds a page\'s use of a state, and the state behind a name the page reads', () => {
    expect(useOfState(index, 'st_preferences')).toEqual({ as: 'preferences', state: 'st_preferences' })
    expect(useOfState(newPost, 'st_preferences')).toBeUndefined()
    expect(stateOfAlias(model, index, 'preferences')?.id).toBe('st_preferences')
    expect(stateOfAlias(model, index, 'all')).toBeUndefined()
    expect(stateOfAlias(model, newPost, 'preferences')).toBeUndefined()
  })
})

describe('stateFieldText', () => {
  it('is the field with its State\'s label, "showDrafts · Blog preferences", or the field alone when asked', () => {
    const state = stateById(model, 'st_preferences')!
    expect(stateFieldText('showDrafts', state)).toBe('showDrafts · Blog preferences')
    expect(stateFieldText('showDrafts', state, false)).toBe('showDrafts')
    expect(stateFieldText('showDrafts', { name: 'preferences' })).toBe('showDrafts · preferences')
  })
})
