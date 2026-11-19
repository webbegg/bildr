import { describe, expect, it } from 'vitest'
import { loadModel } from '@bildr/codegen/model'
import type { Model, PageFile } from '@bildr/codegen/model'
import { branchChoices, computedInput, conditionChoices, conditionOf, conditionSentence } from '../../src/shared/listSource.ts'
import { blogModelFiles } from '../canvas/fixture.ts'

/**
 * A List's conditional source (B4, S4): "if <a True or False value> then <list> else <list>", stored as the page's computed value.
 * Read against the blog fixture: its index page lists `posts`, which is `preferences.showDrafts` ? `all` : `featured`.
 */

const loaded = loadModel(blogModelFiles())
if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
const model: Model = loaded.model
const pageOf = (id: string): PageFile => structuredClone(model.modules.blog!.pages.find(page => page.id === id)!)

describe('conditionOf', () => {
  it('reads the golden blog\'s posts as a condition: showDrafts, then all, else featured', () => {
    expect(conditionOf(pageOf('pg_index'), 'posts')).toEqual({ as: 'posts', path: 'preferences.showDrafts', off: false, then: 'all', else: 'featured' })
  })

  it('reads a "not" of the field as the field being off', () => {
    const page = pageOf('pg_index')
    ;(page.uses!.computed as unknown as Array<{ if: unknown }>)[0]!.if = { not: { $bind: 'preferences.showDrafts' } }
    expect(conditionOf(page, 'posts')).toMatchObject({ path: 'preferences.showDrafts', off: true })
  })

  it('does not read what the panel cannot edit back: a query, a computed value of other shapes', () => {
    const page = pageOf('pg_index')
    expect(conditionOf(page, 'all')).toBeUndefined()
    expect(conditionOf(page, 'nothing')).toBeUndefined()
    const computed = page.uses!.computed as unknown as Array<{ then: unknown }>
    computed[0]!.then = { $template: 'x' }
    expect(conditionOf(page, 'posts')).toBeUndefined()
    computed[0]!.then = { $bind: 'all.length' }
    expect(conditionOf(page, 'posts')).toBeUndefined()
    computed[0]!.then = { $bind: 'posts' }
    expect(conditionOf(page, 'posts')).toBeUndefined()
  })

  it('does not read an entry that holds more than a condition: writing it back would drop the rest', () => {
    const page = pageOf('pg_index')
    ;(page.uses!.computed as unknown as Array<Record<string, unknown>>)[0]!.note = 'by hand'
    expect(conditionOf(page, 'posts')).toBeUndefined()
  })
})

describe('conditionSentence', () => {
  it('says it in words: "If showDrafts is on: Then All posts, Otherwise Featured posts"', () => {
    const page = pageOf('pg_index')
    expect(conditionSentence(model, page, conditionOf(page, 'posts')!)).toBe('If showDrafts is on: Then All posts, Otherwise Featured posts')
    expect(conditionSentence(model, page, { ...conditionOf(page, 'posts')!, off: true })).toBe('If showDrafts is off: Then All posts, Otherwise Featured posts')
  })
})

describe('conditionChoices', () => {
  it('offers the true-or-false State fields, the used one under the page\'s name and the others to be added', () => {
    expect(conditionChoices(model, pageOf('pg_index')).map(choice => [choice.path, choice.label, choice.group, choice.state?.used])).toEqual([['preferences.showDrafts', 'showDrafts', 'Blog preferences', true]])
    expect(conditionChoices(model, pageOf('pg_new_post')).map(choice => [choice.path, choice.label, choice.group, choice.state?.used])).toEqual([
      ['preferences.showDrafts', 'showDrafts', 'Blog preferences', false],
      ['createPost.pending', 'createPost.pending', undefined, undefined]
    ])
  })

  it('titles a State field with its State, and adds the State to the label only where two fields share a name', () => {
    expect(conditionChoices(model, pageOf('pg_index'))[0]!.title).toBe('showDrafts · Blog preferences')
    const copy = structuredClone(model)
    copy.modules.blog!.state.push({ id: 'st_beta', name: 'beta', label: 'Beta flags', persist: 'memory', shape: 'single', fields: [{ id: 'fld_beta_show', name: 'showDrafts', type: 'boolean', default: false }] })
    const page = copy.modules.blog!.pages.find(entry => entry.id === 'pg_index')!
    expect(conditionChoices(copy, page).map(choice => choice.label)).toEqual(['showDrafts · Blog preferences', 'showDrafts · Beta flags'])
  })
})

describe('branchChoices', () => {
  it('lists the page\'s query uses that return a list, with their labels and their collection', () => {
    expect(branchChoices(model, pageOf('pg_index'))).toEqual([
      { alias: 'featured', label: 'Featured posts', entity: 'ent_post' },
      { alias: 'all', label: 'All posts', entity: 'ent_post' },
      { alias: 'quotes', label: 'Latest quotes', entity: 'ent_quote' }
    ])
  })

  it('lists only the ones of one collection when it is given', () => {
    expect(branchChoices(model, pageOf('pg_index'), 'ent_quote').map(choice => choice.alias)).toEqual(['quotes'])
  })
})

describe('computedInput', () => {
  it('is the page_computed_set the golden blog holds', () => {
    expect(computedInput('pg_index', { as: 'posts', path: 'preferences.showDrafts', off: false, then: 'all', else: 'featured' })).toEqual({
      page: 'pg_index', as: 'posts', if: { $bind: 'preferences.showDrafts' }, then: { $bind: 'all' }, else: { $bind: 'featured' }
    })
  })

  it('wraps the field in "not" when it is off', () => {
    expect(computedInput('pg_index', { as: 'posts', path: 'preferences.showDrafts', off: true, then: 'all', else: 'featured' }).if).toEqual({ not: { $bind: 'preferences.showDrafts' } })
  })
})
