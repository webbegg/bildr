// B1 verification (S2, S4, S6): every accepted app-behaviour edit gives an app that typechecks. Each case here was accepted by the
// module and produced a page or composable that `nuxi typecheck` rejected; it must now be refused, or generate code free of that defect.
import { describe, expect, it } from 'vitest'
import { applyEdit } from '../../src/edit/index'
import type { EditName } from '../../src/edit/index'
import { generated } from './behaviour-helpers'
import { applyChanges, project } from './helpers'

const UUID = '0b6f6a52-1c7a-4c1e-9a52-7a0e2f3d9b01'
const INDEX_VUE = 'layers/blog/app/pages/index.vue'

/** The blog with a state "reading" the index page uses, and a Button n_button_1 in its header. */
const withReading = () => {
  const p = project()
  p.edit('state_create', { name: 'reading', fields: [{ name: 'dark', type: 'boolean', default: false }, { name: 'page', type: 'integer', default: 1 }, { name: 'title', type: 'text', default: 'Hello' }, { name: 'note', type: 'text' }] })
  p.edit('page_use_add', { page: 'pg_index', as: 'reading', state: 'st_reading' })
  p.edit('node_insert', { file: 'pg_index', parentId: 'n_head', type: 'Button', props: { text: 'B' } })
  return p
}
const setR = (field: string, value: unknown) => ({ kind: 'setState', state: 'st_reading', field, value })

describe('a value of the wrong type for where it goes is refused', () => {
  it.each([
    ['an integer field set from a text field', [setR('page', { $bind: 'reading.title' })]],
    ['a boolean field set from an integer field', [setR('dark', { $bind: 'reading.page' })]],
    ['a text field set from a list length', [setR('title', { $bind: 'featured.length' })]],
    ['a text field set from a binding whose fallback is a number', [setR('title', { $bind: 'reading.note', fallback: 5 })]],
    ['a toast title from an integer', [{ kind: 'toast', title: { $bind: 'reading.page' } }]],
    ['a toast colour from a text field', [{ kind: 'toast', title: 'x', color: { $bind: 'reading.title' } }]],
    ['a route param from a boolean', [{ kind: 'navigate', to: { page: 'pg_post_detail', params: { slug: { $bind: 'reading.dark' } } } }]],
    ['a uuid action param from an integer', [{ kind: 'runAction', action: 'act_publish_post', args: { id: { $bind: 'reading.page' } } }]],
    ['a collection action given a text literal', [{ kind: 'runAction', action: 'act_create_post', args: { post: 'hello' } }]],
    ['a collection action given a text field', [{ kind: 'runAction', action: 'act_create_post', args: { post: { $bind: 'reading.title' } } }]],
    ['a collection action given a whole list', [{ kind: 'runAction', action: 'act_create_post', args: { post: { $bind: 'featured' } } }]]
  ])('%s', (_, steps) => {
    withReading().refuse('node_interaction_add', { file: 'pg_index', nodeId: 'n_button_1', on: 'click', do: steps }, 'invalid')
  })

  it('an integer field set from a route parameter (text)', () => {
    const p = withReading()
    p.edit('page_use_add', { page: 'pg_post_detail', as: 'reading', state: 'st_reading' })
    p.edit('node_insert', { file: 'pg_post_detail', parentId: 'n_page', type: 'Button', props: { text: 'B' } })
    p.refuse('node_interaction_add', { file: 'pg_post_detail', nodeId: 'n_button_2', on: 'click', do: [setR('page', { $route: 'slug' })] }, 'invalid')
  })

  it('a member of a computed value that is a plain value', () => {
    const p = withReading()
    p.edit('page_computed_set', { page: 'pg_index', as: 'heading', if: { $bind: 'reading.dark' }, then: 'a', else: 'b' })
    p.refuse('node_interaction_add', { file: 'pg_index', nodeId: 'n_button_1', on: 'click', do: [setR('title', { $bind: 'heading.foo' })] }, 'invalid')
    p.refuse('page_computed_set', { page: 'pg_index', as: 'other', if: { $bind: 'reading.dark' }, then: { $bind: 'heading.foo' }, else: 'x' }, 'invalid')
  })

  it('a condition that is always true or false: { "not": "x" }', () => {
    project().refuse('page_computed_set', { page: 'pg_index', as: 'h', if: { not: 'x' }, then: 'a', else: 'b' }, 'invalid')
  })
})

describe('a computed value a List shows keeps its kind', () => {
  it.each([
    ['plain values', { then: 'a', else: 'b' }],
    ['rows of another collection', { then: { $bind: 'quotes' }, else: { $bind: 'quotes' } }]
  ])('posts (the List n_list\'s items) can\'t become %s', (_, branches) => {
    project().refuse('page_computed_set', { page: 'pg_index', as: 'posts', if: { $bind: 'preferences.showDrafts' }, ...branches }, 'invalid')
  })
})

/** Runs the edits; when every one is accepted, returns the generated index page, else undefined (a refusal is a fix too). */
const indexAfter = (edits: Array<[EditName, unknown]>): string | undefined => {
  let files = project().files
  for (const [name, input] of edits) {
    const outcome = applyEdit(files, name, input)
    if (!outcome.ok) return undefined
    files = applyChanges(files, outcome.changes)
  }
  return generated(files)[INDEX_VUE]
}
const declarations = (vue: string, name: string) => vue.split('\n').filter(line => new RegExp(`^const (\\{[^}]*\\b${name}\\b[^}]*\\}|${name}) =`).test(line) || new RegExp(`^const \\{[^}]*: ${name}\\b`).test(line)).length

describe('the names a page script declares never meet', () => {
  it('a computed value named like the setter of a state the page uses (set<As>)', () => {
    const vue = indexAfter([
      ['page_computed_set', { page: 'pg_index', as: 'setPreferences', if: { $bind: 'preferences.showDrafts' }, then: 'a', else: 'b' }],
      ['node_update_props', { file: 'pg_index', nodeId: 'n_h1', props: { text: { $bind: 'setPreferences' } } }]
    ])
    if (vue) expect(declarations(vue, 'setPreferences')).toBe(1)
  })

  it('a computed value named like a query\'s loading flag (<as>Loading)', () => {
    const vue = indexAfter([
      ['page_computed_set', { page: 'pg_index', as: 'featuredLoading', if: { $bind: 'preferences.showDrafts' }, then: 'a', else: 'b' }],
      ['node_update_props', { file: 'pg_index', nodeId: 'n_h1', props: { text: { $bind: 'featuredLoading' } } }]
    ])
    if (vue) expect(declarations(vue, 'featuredLoading')).toBe(1)
  })

  it('a state a setState step adds to the page, next to a use named set<State>', () => {
    const vue = indexAfter([
      ['state_create', { name: 'reading', fields: [{ name: 'dark', type: 'boolean', default: false }] }],
      ['page_use_add', { page: 'pg_index', as: 'setReading', query: 'q_all_posts' }],
      ['node_insert', { file: 'pg_index', parentId: 'n_head', type: 'Text', props: { text: { $bind: 'setReading.length' } } }],
      ['node_insert', { file: 'pg_index', parentId: 'n_head', type: 'Button', props: { text: 'B' } }],
      ['node_interaction_add', { file: 'pg_index', nodeId: 'n_button_1', on: 'click', do: [setR('dark', true)] }]
    ])
    if (vue) expect(declarations(vue, 'setReading')).toBe(1)
  })
})

describe('state names the generated composable declares', () => {
  it('"patch", the setter\'s parameter, is refused or doesn\'t shadow the row', () => {
    const outcome = applyEdit(project().files, 'state_create', { name: 'patch', fields: [{ name: 'on', type: 'boolean', default: false }] })
    if (!outcome.ok) return expect(outcome.code).toBe('invalid')
    const composable = generated(applyChanges(project().files, outcome.changes))['layers/blog/app/composables/blog/useBlogPatch.ts']!
    expect(composable).not.toMatch(/\.\.\.patch\.value/)
  })
})

describe('handlers declared in the script only read what the script has', () => {
  it.each([
    ['a single navigate step with a List item\'s field as param', [{ kind: 'navigate', to: { page: 'pg_post_detail', params: { slug: { $bind: 'post.slug' } } } }]],
    ['a toast then a navigate reading the List item', [{ kind: 'toast', title: { $bind: 'post.title' } }, { kind: 'navigate', to: { page: 'pg_post_detail', params: { slug: { $bind: 'post.slug' } } } }]],
    ['an action then a toast reading the List item', [{ kind: 'runAction', action: 'act_publish_post', args: { id: UUID } }, { kind: 'toast', when: 'success', title: { $bind: 'post.title' } }]]
  ])('%s', (_, steps) => {
    const vue = indexAfter([
      ['node_insert', { file: 'pg_index', parentId: 'n_list', type: 'Button', props: { text: 'Open' } }],
      ['node_interaction_add', { file: 'pg_index', nodeId: 'n_button_1', on: 'click', do: steps }]
    ])
    if (!vue) return
    const script = vue.slice(0, vue.indexOf('</script>'))
    // `post` is the v-for item: only the template has it.
    expect(script).not.toMatch(/[^.\w]post\.(slug|title)/)
  })
})

describe('a computed value read only by another computed value is declared', () => {
  it('heading reads label; only heading is bound', () => {
    const vue = indexAfter([
      ['page_computed_set', { page: 'pg_index', as: 'label', if: { $bind: 'preferences.showDrafts' }, then: 'A', else: 'B' }],
      ['page_computed_set', { page: 'pg_index', as: 'heading', if: { $bind: 'preferences.showDrafts' }, then: { $bind: 'label' }, else: 'x' }],
      ['node_update_props', { file: 'pg_index', nodeId: 'n_h1', props: { text: { $bind: 'heading' } } }]
    ])
    if (vue && /label\.value/.test(vue)) expect(vue).toMatch(/^const label = computed/m)
  })

  it('shown reads posts; the List now binds shown', () => {
    const vue = indexAfter([
      ['page_computed_set', { page: 'pg_index', as: 'shown', if: { $bind: 'preferences.showDrafts' }, then: { $bind: 'posts' }, else: { $bind: 'featured' } }],
      ['node_update_props', { file: 'pg_index', nodeId: 'n_list', props: { items: { $bind: 'shown' } } }]
    ])
    if (vue && /posts\.value/.test(vue)) expect(vue).toMatch(/^const posts = computed/m)
  })
})

describe('a literal condition lints (no-constant-condition)', () => {
  it.each([true, false])('if: %s', (condition) => {
    const vue = indexAfter([
      ['page_computed_set', { page: 'pg_index', as: 'heading', if: condition, then: 'a', else: 'b' }],
      ['node_update_props', { file: 'pg_index', nodeId: 'n_h1', props: { text: { $bind: 'heading' } } }]
    ])
    if (vue) expect(vue).not.toMatch(/computed\(\(\) => (true|false) \?/)
  })
})
