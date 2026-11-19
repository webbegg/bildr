import { describe, expect, it } from 'vitest'
import { loadModel } from '@bildr/codegen/model'
import type { Model, PageFile } from '@bildr/codegen/model'
import { RESERVED as MODULE_RESERVED } from '../../../codegen/src/edit/queries.ts'
import { autoImportedNameProblem } from '../../../codegen/src/edit/reserved-names.ts'
import { AUTO_IMPORTED_FUNCTIONS, RESERVED_NAMES, freeAlias } from '../../src/shared/pageNames.ts'
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

  it('leaves out the names a use derives: a state\'s set…, a query\'s …Loading, an action\'s …Pending and …Error', () => {
    const shown = page()
    shown.uses = { queries: [{ as: 'setPreferences', query: 'q_all_posts' }, { as: 'feed', query: 'q_all_posts' }] }
    expect(freeAlias(shown, 'preferences', 'state')).toBe('preferences2')
    expect(freeAlias(shown, 'feedLoading', 'computed')).toBe('feedLoading2')
    shown.uses = { actions: [{ as: 'save', action: 'act_create_post' }] }
    expect(freeAlias(shown, 'savePending', 'computed')).toBe('savePending2')
    expect(freeAlias(shown, 'saveError', 'computed')).toBe('saveError2')
    // A name whose own derived name is taken is not free either.
    shown.uses = { queries: [{ as: 'listLoading', query: 'q_all_posts' }] }
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

describe('the names the editor copies from the generator', () => {
  it('are the module\'s: its reserved names, and every auto-imported function it refuses as a name', () => {
    expect([...RESERVED_NAMES].sort()).toEqual([...MODULE_RESERVED].sort())
    const unknown = AUTO_IMPORTED_FUNCTIONS.filter(name => !autoImportedNameProblem(name))
    expect(unknown).toEqual([])
  })
})
