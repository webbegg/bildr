import { describe, expect, it } from 'vitest'
import { loadModel } from '@bildr/codegen/model'
import type { Model, PageFile } from '@bildr/codegen/model'
import { AUTO_IMPORTED_FUNCTION_NAMES, RESERVED_PAGE_NAMES } from '@bildr/codegen/edit'
import { autoImportedNameProblem } from '../../../codegen/src/edit/reserved-names.ts'
import { freeAlias } from '../../src/shared/pageNames.ts'
import { blogModelFiles } from '../canvas/fixture.ts'

/**
 * The name a page gives a use (B4): the first one the page's script can declare. Read against the blog fixture's new-post page, which
 * has no use of State and a Form; the module (`page_use_add`, `page_computed_set`) is the last word, this keeps the editor from
 * offering a name it refuses, or one that the page would read as something else.
 */

const loaded = loadModel(blogModelFiles())
if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
const model: Model = loaded.model
const page = (): PageFile => structuredClone(model.modules.blog!.pages.find(entry => entry.id === 'pg_new_post')!)

describe('freeAlias', () => {
  it('is the name asked for when nothing in the page has it', () => {
    expect(freeAlias(page(), 'preferences', 'state')).toBe('preferences')
  })

  it('takes the next free name when a use of the page has it, whatever kind of use', () => {
    const shown = page()
    shown.uses = { ...shown.uses, queries: [...shown.uses?.queries ?? [], { as: 'preferences', query: 'q_all_posts' }] }
    expect(freeAlias(shown, 'preferences', 'state')).toBe('preferences2')
    shown.uses.computed = [{ as: 'posts' }]
    expect(freeAlias(shown, 'posts', 'computed')).toBe('posts2')
  })

  it('leaves out the names a use derives: a state\'s set…, a query\'s …Status, an action\'s …Pending and …Error', () => {
    const shown = page()
    shown.uses = { queries: [{ as: 'setPreferences', query: 'q_all_posts' }, { as: 'feed', query: 'q_all_posts' }] }
    expect(freeAlias(shown, 'preferences', 'state')).toBe('preferences2')
    // codegen-architecture T3c2: a module query derives its status, as an API one does; its …Loading is free.
    expect(freeAlias(shown, 'feedStatus', 'computed')).toBe('feedStatus2')
    expect(freeAlias(shown, 'feedLoading', 'computed')).toBe('feedLoading')
    shown.uses = { actions: [{ as: 'save', action: 'act_create_post' }] }
    expect(freeAlias(shown, 'savePending', 'computed')).toBe('savePending2')
    expect(freeAlias(shown, 'saveError', 'computed')).toBe('saveError2')
    // A name whose own derived name is taken is not free either.
    shown.uses = { queries: [{ as: 'listStatus', query: 'q_all_posts' }] }
    expect(freeAlias(shown, 'list', 'query')).toBe('list2')
  })

  it('leaves out the names a List gives its records, wherever in the page', () => {
    const shown = page()
    shown.root.children = [{ id: 'n_a', type: 'Row', children: [{ id: 'n_l', type: 'List', props: { items: { $bind: 'x' }, as: 'posts' } }] }]
    expect(freeAlias(shown, 'posts', 'computed')).toBe('posts2')
  })

  it('leaves out the page\'s route parameters', () => {
    const shown = page()
    shown.path = '/posts/:slug'
    expect(freeAlias(shown, 'slug', 'computed')).toBe('slug2')
  })

  it('leaves out the names the page\'s script uses itself, and the ones Vue and Nuxt provide to it', () => {
    const shown = page()
    expect(freeAlias(shown, 'toast', 'state')).toBe('toast2')
    expect(freeAlias(shown, 'route', 'computed')).toBe('route2')
    expect(freeAlias(shown, 'computed', 'computed')).toBe('computed2')
    expect(freeAlias(shown, 'ref', 'state')).toBe('ref2')
    expect(freeAlias(shown, 'navigateTo', 'computed')).toBe('navigateTo2')
    expect(freeAlias(shown, 'useRoute', 'computed')).toBe('useRoute2')
  })
})

describe('the names the page\'s script declares for what is in it (B7)', () => {
  it('leaves out the handler of each interaction, `on<Node><Event>`', () => {
    // The new-post form has a submit interaction: its handler is onFormSubmit.
    const shown = page()
    expect(freeAlias(shown, 'onFormSubmit', 'computed')).toBe('onFormSubmit2')
    expect(freeAlias(shown, 'onFormClick', 'computed')).toBe('onFormClick')
  })

  // codegen-architecture T3c: an API use derives its status (`<as>Status`), as the module claims it; its …Loading and …Error are free.
  it('leaves out the name an API query\'s use derives: its …Status, and counts the page\'s API uses as taken', () => {
    const shown = page()
    shown.uses = { apis: [{ as: 'products', datasource: 'ds_catalog', query: 'products' }] }
    expect(freeAlias(shown, 'products', 'api')).toBe('products2')
    expect(freeAlias(shown, 'productsStatus', 'computed')).toBe('productsStatus2')
    expect(freeAlias(shown, 'productsLoading', 'computed')).toBe('productsLoading')
    expect(freeAlias(shown, 'productsError', 'computed')).toBe('productsError')
    // A name that would collide with what a new API use derives is not offered either.
    shown.uses = { queries: [{ as: 'productsStatus', query: 'q_all_posts' }] }
    expect(freeAlias(shown, 'products', 'api')).toBe('products2')
  })

  it('leaves out the counter of a List that loads more, `shown<Node>`', () => {
    const shown = page()
    shown.root.children = [{ id: 'n_feed', type: 'List', props: { items: { $bind: 'x' }, as: 'post', loadMore: 5 } }]
    expect(freeAlias(shown, 'shownFeed', 'computed')).toBe('shownFeed2')
    shown.root.children = [{ id: 'n_feed', type: 'List', props: { items: { $bind: 'x' }, as: 'post' } }]
    expect(freeAlias(shown, 'shownFeed', 'computed')).toBe('shownFeed')
  })
})

describe('the names the editor reads from the generator', () => {
  it('are the module\'s own lists: no name the generator reserves or auto-imports is offered, and the module refuses each', () => {
    const shown = page()
    expect(RESERVED_PAGE_NAMES).toContain('toast')
    expect(AUTO_IMPORTED_FUNCTION_NAMES).toContain('navigateTo')
    for (const name of [...RESERVED_PAGE_NAMES, ...AUTO_IMPORTED_FUNCTION_NAMES]) expect(freeAlias(shown, name, 'computed'), name).not.toBe(name)
    expect(AUTO_IMPORTED_FUNCTION_NAMES.filter(name => !autoImportedNameProblem(name))).toEqual([])
  })
})
