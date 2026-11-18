// B1 verification, second round: what the first regression file (b1-verify-regressions.test.ts) doesn't pin. Each case was accepted by the
// module and gave an app `nuxi typecheck` or eslint refused, or left the model holding something that stopped a later edit.
import { describe, expect, it } from 'vitest'
import { generated } from './behaviour-helpers'
import { project } from './helpers'

const UUID = '0b6f6a52-1c7a-4c1e-9a52-7a0e2f3d9b01'
const INDEX_VUE = 'layers/blog/app/pages/index.vue'

/** The blog with a state "reading", used by the index page, a Button n_button_1 in its header and one (n_button_2) in the posts List. */
const base = () => {
  const p = project()
  p.edit('state_create', { name: 'reading', fields: [{ name: 'dark', type: 'boolean', default: false }, { name: 'page', type: 'integer', default: 1 }, { name: 'title', type: 'text', default: 'Hello' }, { name: 'note', type: 'text' }] })
  p.edit('page_use_add', { page: 'pg_index', as: 'reading', state: 'st_reading' })
  p.edit('node_insert', { file: 'pg_index', parentId: 'n_head', type: 'Button', props: { text: 'B' } })
  p.edit('node_insert', { file: 'pg_index', parentId: 'n_list', type: 'Button', props: { text: 'Open' } })
  return p
}
const set = (field: string, value: unknown) => ({ kind: 'setState', state: 'st_reading', field, value })
const add = (p: ReturnType<typeof base>, steps: unknown[], nodeId = 'n_button_1') => p.edit('node_interaction_add', { file: 'pg_index', nodeId, on: 'click', do: steps })
const refuseAdd = (p: ReturnType<typeof base>, steps: unknown[], nodeId = 'n_button_1') => p.refuse('node_interaction_add', { file: 'pg_index', nodeId, on: 'click', do: steps }, 'invalid').message

describe('the value of a step is checked against what receives it', () => {
  it('a template is text: it fits a text field, not a number', () => {
    add(base(), [set('title', { $template: 'Page {reading.page}' })])
    expect(refuseAdd(base(), [set('page', { $template: 'Page {reading.page}' })])).toContain('text')
  })

  it('an action\'s pending is true or false, a list\'s length a number', () => {
    const p = base()
    p.edit('page_use_add', { page: 'pg_index', as: 'publish', action: 'act_publish_post' })
    add(p, [set('dark', { $bind: 'publish.pending' })])
    add(base(), [set('page', { $bind: 'featured.length' })])
    expect(refuseAdd(base(), [set('title', { $bind: 'featured.length' })])).toContain('a number')
    expect(refuseAdd(p, [set('page', { $bind: 'publish.pending' })], 'n_button_2')).toContain('true or false')
  })

  it('a value that can be empty needs a fallback where the place takes only a value', () => {
    const p = base()
    // note has no default and isn't required: it can be unset. A route param takes text or a number, never unset.
    const to = (slug: unknown) => [{ kind: 'navigate', to: { page: 'pg_post_detail', params: { slug } } }]
    expect(refuseAdd(p, to({ $bind: 'reading.note' }))).toContain('fallback')
    add(p, to({ $bind: 'reading.note', fallback: 'welcome' }))
    // The setter takes a partial row, so unset passes; a nullable column (publishedAt) can be null and a text field can't.
    add(base(), [set('title', { $bind: 'reading.note' })], 'n_button_2')
    const q = base()
    expect(refuseAdd(q, [set('title', { $bind: 'post.publishedAt' })], 'n_button_2')).toContain('empty')
    add(q, [set('title', { $bind: 'post.publishedAt', fallback: '' })], 'n_button_2')
  })

  it('a toast takes a colour written out, text for the title and icon, and a fallback literal counts as its own type', () => {
    add(base(), [{ kind: 'toast', title: { $bind: 'reading.title' }, description: { $template: 'On page {reading.page}' }, color: 'success', icon: 'i-lucide-check' }])
    expect(refuseAdd(base(), [{ kind: 'toast', title: 'x', icon: { $bind: 'reading.page' } }])).toContain('number')
    expect(refuseAdd(base(), [{ kind: 'toast', title: { $bind: 'reading.dark', fallback: 1 } }])).toContain('text')
  })

  it('an action on a collection takes a row of it (the List\'s item, or the form), not another collection\'s', () => {
    const p = base()
    add(p, [{ kind: 'runAction', action: 'act_create_post', args: { post: { $bind: 'post' } } }], 'n_button_2')
    expect(refuseAdd(base(), [{ kind: 'runAction', action: 'act_create_post', args: { post: { $bind: 'reading' } } }])).toContain('row')
    expect(refuseAdd(base(), [{ kind: 'runAction', action: 'act_create_post', args: { post: { $bind: 'quotes' } } }])).toContain('list')
  })

  it('a uuid parameter takes text (a row\'s id, a route parameter), not a number', () => {
    const p = base()
    add(p, [{ kind: 'runAction', action: 'act_publish_post', args: { id: { $bind: 'post.id' } } }], 'n_button_2')
    add(p, [{ kind: 'runAction', action: 'act_publish_post', args: { id: UUID } }, { kind: 'toast', when: 'success', title: 'Done' }], 'n_button_1')
  })

  it('a step is checked again when the computed value it reads changes kind', () => {
    const p = base()
    p.edit('page_computed_set', { page: 'pg_index', as: 'heading', if: { $bind: 'reading.dark' }, then: 'a', else: 'b' })
    add(p, [set('title', { $bind: 'heading' })])
    const message = p.refuse('page_computed_set', { page: 'pg_index', as: 'heading', if: { $bind: 'reading.dark' }, then: 1, else: 2 }, 'invalid').message
    expect(message).toContain('n_button_1')
  })
})

describe('a literal or fixed condition is refused', () => {
  it.each([[true], [false], ['x'], [1], [{ not: true }], [{ not: 'x' }], [{ not: { not: false } }]])('if: %j', (condition) => {
    const message = project().refuse('page_computed_set', { page: 'pg_index', as: 'heading', if: condition, then: 'a', else: 'b' }, 'invalid').message
    expect(message).toContain('has to read something')
  })

  it('a binding, or the opposite of one, is accepted', () => {
    const p = project()
    p.edit('page_computed_set', { page: 'pg_index', as: 'heading', if: { $bind: 'preferences.showDrafts' }, then: 'a', else: 'b' })
    p.edit('page_computed_set', { page: 'pg_index', as: 'subheading', if: { not: { $bind: 'preferences.showDrafts' } }, then: 'a', else: 'b' })
  })
})

describe('names the generated code declares', () => {
  it.each(['patch', 'q', 'draft', 'ref', 'reactive', 'computed', 'navigateTo', 'useRoute', 'definePageMeta', 'watch'])('a state called %s is refused', (name) => {
    project().refuse('state_create', { name }, 'invalid')
  })

  it.each(['ref', 'navigateTo', 'reactive', 'useToast', 'computed'])('a page use called %s is refused, whatever it is', (as) => {
    const p = project()
    p.refuse('page_use_add', { page: 'pg_index', as, query: 'q_all_posts' }, 'invalid')
    p.refuse('page_use_add', { page: 'pg_index', as, state: 'st_preferences' }, 'invalid')
    p.refuse('page_use_add', { page: 'pg_new_post', as, action: 'act_publish_post' }, 'invalid')
    p.refuse('page_computed_set', { page: 'pg_index', as, if: { $bind: 'preferences.showDrafts' }, then: 'a', else: 'b' }, 'invalid')
  })

  it('a use meeting what the page derives from another is refused, either way round', () => {
    const p = project()
    // preferences → setPreferences; featured → featuredLoading; a new action → <as>Pending and <as>Error
    p.refuse('page_use_add', { page: 'pg_index', as: 'setPreferences', query: 'q_all_posts' }, 'invalid')
    p.refuse('page_use_add', { page: 'pg_index', as: 'featuredLoading', action: 'act_publish_post' }, 'invalid')
    p.edit('page_computed_set', { page: 'pg_index', as: 'setHeading', if: { $bind: 'preferences.showDrafts' }, then: 'a', else: 'b' })
    p.refuse('page_use_add', { page: 'pg_index', as: 'heading', state: 'st_preferences' }, 'invalid')
    p.edit('page_computed_set', { page: 'pg_index', as: 'publishPending', if: { $bind: 'preferences.showDrafts' }, then: 'a', else: 'b' })
    p.refuse('page_use_add', { page: 'pg_index', as: 'publish', action: 'act_publish_post' }, 'invalid')
  })

  it('an action a step runs takes a free name when the usual one is taken', () => {
    const p = project()
    p.edit('page_computed_set', { page: 'pg_index', as: 'publishPost', if: { $bind: 'preferences.showDrafts' }, then: 'a', else: 'b' })
    p.edit('node_insert', { file: 'pg_index', parentId: 'n_head', type: 'Button', props: { text: 'B' } })
    const added = p.edit('node_interaction_add', { file: 'pg_index', nodeId: 'n_button_1', on: 'click', do: [{ kind: 'runAction', action: 'act_publish_post', args: { id: UUID } }] }).addedUses
    expect(added).toEqual([{ as: 'publishPost2', action: 'act_publish_post' }])
  })

  it('the generated composable of a state never declares its name twice', () => {
    const files = generated(base().files)
    const composable = files['layers/blog/app/composables/blog/useBlogReading.ts']!
    expect(composable).toContain('const set = (patch:')
  })
})

describe('a handler the script declares takes the List item the template has', () => {
  const vueOf = (steps: unknown[], parent: string) => {
    const p = project()
    p.edit('node_insert', { file: 'pg_index', parentId: parent, type: 'Button', props: { text: 'Open' } })
    p.edit('node_interaction_add', { file: 'pg_index', nodeId: 'n_button_1', on: 'click', do: steps })
    return generated(p.files)[INDEX_VUE]!
  }
  const open = [{ kind: 'navigate', to: { page: 'pg_post_detail', params: { slug: { $bind: 'post.slug' } } } }]

  it('goes to a page from a List row: the template passes the item, the handler names it as a parameter', () => {
    const vue = vueOf(open, 'n_list')
    expect(vue).toContain('@click="onButton1Click(post)"')
    expect(vue).toContain('const onButton1Click = async (postItem: NonNullable<typeof posts.value>[number]) => {')
    expect(vue).toContain('params: { slug: postItem.slug }')
  })

  it('does the same for a Button in a slot an Instance in the List fills', () => {
    const vue = vueOf([{ kind: 'toast', title: { $bind: 'post.title' } }, ...open], 'n_card_actions')
    expect(vue).toContain('onButton1Click(post)')
    expect(vue).toContain('title: postItem.title')
  })

  it('leaves a handler that reads no item as it was', () => {
    const vue = vueOf([{ kind: 'navigate', to: { page: 'pg_post_detail', params: { slug: 'welcome' } } }], 'n_head')
    expect(vue).toContain('@click="onButton1Click"')
    expect(vue).toContain('const onButton1Click = async () => {')
  })
})

describe('a computed value only another computed value reads', () => {
  it('is declared, above the one that reads it', () => {
    const p = project()
    p.edit('page_computed_set', { page: 'pg_index', as: 'label', if: { $bind: 'preferences.showDrafts' }, then: 'A', else: 'B' })
    p.edit('page_computed_set', { page: 'pg_index', as: 'heading', if: { $bind: 'preferences.showDrafts' }, then: { $bind: 'label' }, else: 'x' })
    p.edit('node_update_props', { file: 'pg_index', nodeId: 'n_h1', props: { text: { $bind: 'heading' } } })
    const vue = generated(p.files)[INDEX_VUE]!
    expect(vue.indexOf('const label = computed')).toBeGreaterThan(-1)
    expect(vue.indexOf('const label = computed')).toBeLessThan(vue.indexOf('const heading = computed'))
  })

  it('is declared above, even when it comes later in the page\'s list', () => {
    const p = project()
    p.edit('page_computed_set', { page: 'pg_index', as: 'heading', if: { $bind: 'preferences.showDrafts' }, then: 'x', else: 'y' })
    p.edit('page_computed_set', { page: 'pg_index', as: 'label', if: { $bind: 'preferences.showDrafts' }, then: 'A', else: 'B' })
    p.edit('page_computed_set', { page: 'pg_index', as: 'heading', if: { $bind: 'preferences.showDrafts' }, then: { $bind: 'label' }, else: 'x' })
    p.edit('node_update_props', { file: 'pg_index', nodeId: 'n_h1', props: { text: { $bind: 'heading' } } })
    const vue = generated(p.files)[INDEX_VUE]!
    expect(vue.indexOf('const label = computed')).toBeLessThan(vue.indexOf('const heading = computed'))
  })
})

describe('taking an interaction away takes the uses it added', () => {
  it('removing the last step that sets a state drops the use, and the state can be deleted', () => {
    const p = base()
    const index = add(p, [set('dark', true)]).index
    expect(p.edit('node_interaction_remove', { file: 'pg_index', nodeId: 'n_button_1', index }).droppedUses).toEqual([{ as: 'reading', state: 'st_reading' }])
    p.edit('state_delete', { state: 'st_reading' })
  })

  it('a use something still binds or sets stays', () => {
    const p = project()
    // The Show drafts checkbox binds preferences and sets it: taking its interaction away keeps the use (the binding reads it).
    const result = p.edit('node_interaction_remove', { file: 'pg_index', nodeId: 'n_toggle', index: 0 })
    expect(result.droppedUses).toEqual([])
    expect(p.json('.bildr/modules/blog/pages/index.json').uses.state).toEqual([{ as: 'preferences', state: 'st_preferences' }])
  })

  it('an update that swaps the state for another drops the first use, and keeps what the new steps name', () => {
    const p = base()
    p.edit('state_create', { name: 'other', fields: [{ name: 'on', type: 'boolean', default: false }] })
    const first = add(p, [set('dark', true)])
    const update = p.edit('node_interaction_update', {
      file: 'pg_index', nodeId: 'n_button_1', index: first.index, do: [{ kind: 'setState', state: 'st_other', field: 'on', value: true }]
    })
    expect(update.addedUses).toEqual([{ as: 'other', state: 'st_other' }])
    expect(update.droppedUses).toEqual([{ as: 'reading', state: 'st_reading' }])
    p.edit('state_delete', { state: 'st_reading' })
  })

  it('an action a Form runs stays, one only a step runs goes', () => {
    const p = project()
    const keep = p.edit('node_interaction_update', { file: 'pg_new_post', nodeId: 'n_form', index: 0, do: [{ kind: 'toast', title: 'Hi' }] })
    expect(keep.droppedUses).toEqual([])
    expect(p.json('.bildr/modules/blog/pages/new-post.json').uses.actions).toEqual([{ as: 'createPost', action: 'act_create_post' }])
    p.edit('node_insert', { file: 'pg_index', parentId: 'n_head', type: 'Button', props: { text: 'B' } })
    const run = p.edit('node_interaction_add', { file: 'pg_index', nodeId: 'n_button_1', on: 'click', do: [{ kind: 'runAction', action: 'act_publish_post', args: { id: UUID } }] })
    expect(run.addedUses).toEqual([{ as: 'publishPost', action: 'act_publish_post' }])
    expect(p.edit('node_interaction_remove', { file: 'pg_index', nodeId: 'n_button_1', index: run.index }).droppedUses).toEqual([{ as: 'publishPost', action: 'act_publish_post' }])
  })
})

describe('a state field a query argument reads', () => {
  it('is used: it can\'t be removed, and the use can\'t go', () => {
    const p = project()
    p.edit('state_create', { name: 'reading', fields: [{ name: 'count', type: 'integer', default: 3 }, { name: 'other', type: 'text', default: '' }] })
    p.edit('page_use_add', { page: 'pg_index', as: 'reading', state: 'st_reading' })
    p.edit('page_use_update', { page: 'pg_index', as: 'featured', args: { limit: { $bind: 'reading.count' } } })
    const update = p.refuse('state_update', { state: 'st_reading', fields: [{ name: 'other', type: 'text', default: '' }] }, 'invalid').message
    expect(update).toContain('pg_index')
    p.refuse('page_use_remove', { page: 'pg_index', state: 'st_reading' }, 'invalid')
    // The other field is free to change.
    p.edit('state_update', { state: 'st_reading', fields: [{ name: 'count', type: 'integer', default: 3 }] })
  })
})
