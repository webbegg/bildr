import { describe, expect, it } from 'vitest'
import { computedUsesOf, stateFieldUsesIndex, stateFieldUsesOf, usesOf } from '../../src/edit/index'
import { project } from './helpers'
import { expectGenerates, generated, INDEX, NEW_POST } from './behaviour-helpers'

/**
 * B1 (S1, S3, S4, S6): a page uses a state (`page_use_add` / `page_use_remove` with `state`), and a computed value
 * (`page_computed_set` / `page_computed_remove`: "if <condition> then <a> else <b>") a List can take as its source.
 */

const withReading = () => {
  const p = project()
  p.edit('state_create', { name: 'reading', fields: [{ name: 'dark', type: 'boolean', default: false }, { name: 'page', type: 'integer', default: 1 }] })
  return p
}

describe('page_use_add with a state', () => {
  it('makes the page use the state under a name, and the page generates with it', () => {
    const p = withReading()
    expect(p.edit('page_use_add', { page: 'pg_new_post', as: 'reading', state: 'st_reading' })).toMatchObject({ as: 'reading' })
    expect(p.json(NEW_POST).uses.state).toEqual([{ as: 'reading', state: 'st_reading' }])
    expect(p.json(NEW_POST).uses.actions).toBeDefined()
    expectGenerates(p)
  })

  it('refuses a query and a state together, neither, an unknown state, or one the page already uses', () => {
    const p = withReading()
    p.refuse('page_use_add', { page: 'pg_new_post', as: 'reading', state: 'st_reading', query: 'q_all_posts' }, 'invalid')
    p.refuse('page_use_add', { page: 'pg_new_post', as: 'reading' }, 'invalid')
    p.refuse('page_use_add', { page: 'pg_new_post', as: 'reading', state: 'st_nope' }, 'not_found')
    p.refuse('page_use_add', { page: 'pg_index', as: 'prefs', state: 'st_preferences' }, 'invalid')
  })

  it('refuses a name the page script uses or the page already uses, and args', () => {
    const p = withReading()
    p.refuse('page_use_add', { page: 'pg_new_post', as: 'route', state: 'st_reading' }, 'invalid')
    p.refuse('page_use_add', { page: 'pg_new_post', as: 'createPost', state: 'st_reading' }, 'invalid')
    p.refuse('page_use_add', { page: 'pg_new_post', as: 'reading', state: 'st_reading', args: { a: 1 } }, 'invalid')
  })

  it('still adds queries and actions', () => {
    const p = project()
    p.edit('page_use_add', { page: 'pg_new_post', as: 'everything', query: 'q_all_posts' })
    expect(p.json(NEW_POST).uses.queries).toEqual([{ as: 'everything', query: 'q_all_posts' }])
  })
})

describe('page_use_remove with a state', () => {
  it('removes the use by its name or by its state id, and drops an empty uses.state', () => {
    const p = withReading()
    p.edit('page_use_add', { page: 'pg_new_post', as: 'reading', state: 'st_reading' })
    p.edit('page_use_remove', { page: 'pg_new_post', as: 'reading' })
    expect(p.json(NEW_POST).uses.state).toBeUndefined()
    p.edit('page_use_add', { page: 'pg_new_post', as: 'reading', state: 'st_reading' })
    p.edit('page_use_remove', { page: 'pg_new_post', state: 'st_reading' })
    expect(p.json(NEW_POST).uses.state).toBeUndefined()
    expectGenerates(p)
  })

  it('is refused while the page binds the name, naming it', () => {
    const p = project()
    expect(p.refuse('page_use_remove', { page: 'pg_index', as: 'preferences' }, 'invalid').message).toContain('preferences')
    p.refuse('page_use_remove', { page: 'pg_index', state: 'st_preferences' }, 'invalid')
  })

  it('is refused while a node of the page sets the state, naming it', () => {
    const p = withReading()
    p.edit('node_interaction_add', { file: 'pg_new_post', nodeId: 'n_cancel', on: 'mouseenter', do: [{ kind: 'setState', state: 'st_reading', field: 'page', value: 2 }] })
    expect(p.refuse('page_use_remove', { page: 'pg_new_post', state: 'st_reading' }, 'invalid').message).toContain('n_cancel')
  })

  it('needs a name or a state, agreeing when both are given, and an existing use', () => {
    const p = withReading()
    p.refuse('page_use_remove', { page: 'pg_index' }, 'invalid')
    p.refuse('page_use_remove', { page: 'pg_index', as: 'all', state: 'st_preferences' }, 'invalid')
    p.refuse('page_use_remove', { page: 'pg_new_post', state: 'st_reading' }, 'not_found')
    p.refuse('page_use_remove', { page: 'pg_new_post', as: 'nothing' }, 'not_found')
  })
})

describe('page_computed_set', () => {
  const SHOWN = { page: 'pg_index', as: 'shown', if: { $bind: 'preferences.showDrafts' }, then: { $bind: 'all' }, else: { $bind: 'featured' } }

  it('creates a computed value after the page\'s others, and a List can take it as its source', () => {
    const p = project()
    p.edit('page_computed_set', SHOWN)
    expect(p.json(INDEX).uses.computed).toEqual([
      { as: 'posts', if: { $bind: 'preferences.showDrafts' }, then: { $bind: 'all' }, else: { $bind: 'featured' } },
      { as: 'shown', if: { $bind: 'preferences.showDrafts' }, then: { $bind: 'all' }, else: { $bind: 'featured' } }
    ])
    p.edit('node_update_props', { file: 'pg_index', nodeId: 'n_list', props: { items: { $bind: 'shown' } } })
    const vue = generated(p.files)['layers/blog/app/pages/index.vue']!
    expect(vue).toContain('const shown = computed(() => preferences.value.showDrafts ? all.value : featured.value)')
  })

  it('replaces a computed value of the same name in place', () => {
    const p = project()
    p.edit('page_computed_set', { page: 'pg_index', as: 'posts', if: { not: { $bind: 'preferences.showDrafts' } }, then: { $bind: 'featured' }, else: { $bind: 'all' } })
    expect(p.json(INDEX).uses.computed).toEqual([{ as: 'posts', if: { not: { $bind: 'preferences.showDrafts' } }, then: { $bind: 'featured' }, else: { $bind: 'all' } }])
    expectGenerates(p)
  })

  it('takes a fixed condition and scalar branches', () => {
    const p = project()
    p.edit('page_computed_set', { page: 'pg_index', as: 'title', if: { $bind: 'preferences.showDrafts' }, then: 'Everything', else: 'Featured' })
    p.edit('node_update_props', { file: 'pg_index', nodeId: 'n_h1', props: { text: { $bind: 'title' } } })
    expectGenerates(p)
  })

  it('refuses a name the page already uses for something else, or its script uses', () => {
    const p = project()
    p.refuse('page_computed_set', { ...SHOWN, as: 'all' }, 'invalid')
    p.refuse('page_computed_set', { ...SHOWN, as: 'preferences' }, 'invalid')
    p.refuse('page_computed_set', { ...SHOWN, as: 'route' }, 'invalid')
    p.refuse('page_computed_set', { ...SHOWN, as: 'Not camel' }, 'invalid_input')
  })

  it('refuses expressions that do not resolve in the page scope', () => {
    const p = project()
    expect(p.refuse('page_computed_set', { ...SHOWN, if: { $bind: 'nothing.showDrafts' } }, 'invalid').message).toContain('nothing')
    p.refuse('page_computed_set', { ...SHOWN, if: { $bind: 'preferences.nope' } }, 'invalid')
    p.refuse('page_computed_set', { ...SHOWN, then: { $bind: 'nope' } }, 'invalid')
    p.refuse('page_computed_set', { ...SHOWN, else: { $bind: 'post' } }, 'invalid')
    p.refuse('page_computed_set', { ...SHOWN, if: { $param: 'x' } }, 'invalid')
    p.refuse('page_computed_set', { ...SHOWN, if: { $event: 'checked' } }, 'invalid')
    p.refuse('page_computed_set', { ...SHOWN, then: null }, 'invalid')
    p.refuse('page_computed_set', { ...SHOWN, then: [1] }, 'invalid')
    p.refuse('page_computed_set', { ...SHOWN, if: 'yes' }, 'invalid')
  })

  it('refuses branches that are not the same kind of value, naming both', () => {
    const p = project()
    const mixed = p.refuse('page_computed_set', { ...SHOWN, else: { $bind: 'quotes' } }, 'invalid').message
    expect(mixed).toContain('then')
    expect(mixed).toContain('else')
    p.refuse('page_computed_set', { ...SHOWN, else: 'nothing' }, 'invalid')
    p.refuse('page_computed_set', { ...SHOWN, then: { $bind: 'preferences.showDrafts' }, else: { $bind: 'all' } }, 'invalid')
  })

  it('refuses a computed value that reads itself, directly or through another', () => {
    const p = project()
    p.refuse('page_computed_set', { ...SHOWN, as: 'posts', then: { $bind: 'posts' } }, 'invalid')
    p.edit('page_computed_set', { ...SHOWN, then: { $bind: 'posts' } })
    expect(p.refuse('page_computed_set', { ...SHOWN, as: 'posts', then: { $bind: 'shown' }, else: { $bind: 'featured' } }, 'invalid').message).toContain('shown')
  })

  it('refuses an unknown page, and input of the wrong shape', () => {
    const p = project()
    p.refuse('page_computed_set', { ...SHOWN, page: 'pg_nope' }, 'not_found')
    p.refuse('page_computed_set', { page: 'pg_index', as: 'x' }, 'invalid_input')
  })

  it('leaves a model that still generates with an unused computed value', () => {
    const p = project()
    p.edit('page_computed_set', SHOWN)
    expectGenerates(p)
  })
})

describe('page_computed_remove', () => {
  it('removes an unread computed value, and drops an empty computed list', () => {
    const p = project()
    p.edit('page_computed_set', { page: 'pg_index', as: 'shown', if: { $bind: 'preferences.showDrafts' }, then: { $bind: 'all' }, else: { $bind: 'featured' } })
    p.edit('page_computed_remove', { page: 'pg_index', as: 'shown' })
    expect(p.json(INDEX).uses.computed.map((entry: { as: string }) => entry.as)).toEqual(['posts'])
    expectGenerates(p)
  })

  it('is refused while a node binds it, naming the node, and for an unknown one', () => {
    const p = project()
    expect(p.refuse('page_computed_remove', { page: 'pg_index', as: 'posts' }, 'invalid').message).toContain('n_list')
    p.refuse('page_computed_remove', { page: 'pg_index', as: 'nothing' }, 'not_found')
    p.refuse('page_computed_remove', { page: 'pg_nope', as: 'posts' }, 'not_found')
  })

  it('is refused while another computed value reads it', () => {
    const p = project()
    p.edit('page_computed_set', { page: 'pg_index', as: 'again', if: { $bind: 'preferences.showDrafts' }, then: { $bind: 'posts' }, else: { $bind: 'featured' } })
    expect(p.refuse('page_computed_remove', { page: 'pg_index', as: 'posts' }, 'invalid').message).toContain('computed')
  })

  it('drops uses when the last computed value goes', () => {
    const p = project()
    p.edit('node_update_props', { file: 'pg_index', nodeId: 'n_list', props: { items: { $bind: 'featured' } } })
    p.edit('page_computed_remove', { page: 'pg_index', as: 'posts' })
    expect(p.json(INDEX).uses.computed).toBeUndefined()
    expect(p.json(INDEX).uses.queries).toBeDefined()
  })
})

describe('the usage index with state and computed values', () => {
  it('counts the bindings and the setState steps of a state field, by field', () => {
    const model = project().model()
    const uses = stateFieldUsesOf(model, 'st_preferences', 'showDrafts')
    expect(uses).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'page', id: 'pg_index', via: 'bind', where: 'computed', as: 'preferences' }),
      expect.objectContaining({ kind: 'page', id: 'pg_index', via: 'bind', node: 'n_toggle', as: 'preferences' }),
      expect.objectContaining({ kind: 'page', id: 'pg_index', via: 'interaction', node: 'n_toggle' })
    ]))
    expect(stateFieldUsesOf(model, 'st_preferences', 'nope')).toEqual([])
    expect([...stateFieldUsesIndex(model, 'st_preferences').keys()]).toEqual(['showDrafts'])
    expect(stateFieldUsesIndex(model, 'st_nope').size).toBe(0)
  })

  it('counts the whole row, bound by its name, as a use of every field', () => {
    const p = withReading()
    p.edit('page_use_add', { page: 'pg_new_post', as: 'reading', state: 'st_reading' })
    p.edit('node_update_props', { file: 'pg_new_post', nodeId: 'n_cancel', props: { text: { $bind: 'reading' } } })
    const index = stateFieldUsesIndex(p.model(), 'st_reading')
    expect(index.get('dark')).toHaveLength(1)
    expect(index.get('page')).toHaveLength(1)
  })

  it('lists the binds of a state\'s alias among the state\'s own uses', () => {
    const uses = usesOf(project().model(), 'st_preferences')
    expect(uses.filter(use => use.via === 'uses').map(use => use.id)).toEqual(['pg_index'])
    expect(uses.filter(use => use.via === 'bind').map(use => use.where).sort()).toEqual(['computed', 'n_toggle'])
    expect(uses.some(use => use.via === 'interaction' && use.node === 'n_toggle')).toBe(true)
  })

  it('counts the nodes and computed values that bind a computed value', () => {
    const model = project().model()
    expect(computedUsesOf(model, 'pg_index', 'posts').map(use => use.where)).toEqual(['n_list'])
    expect(computedUsesOf(model, 'pg_index', 'nothing')).toEqual([])
    expect(computedUsesOf(model, 'pg_nope', 'posts')).toEqual([])
  })

  it('counts a navigate, a runAction and a setState step as uses of their targets', () => {
    const model = project().model()
    expect(usesOf(model, 'pg_post_detail').some(use => use.id === 'pg_new_post' && use.via === 'interaction')).toBe(true)
    expect(usesOf(model, 'act_create_post').some(use => use.id === 'pg_new_post' && use.via === 'interaction')).toBe(true)
    expect(usesOf(model, 'st_preferences').some(use => use.via === 'interaction')).toBe(true)
  })
})
