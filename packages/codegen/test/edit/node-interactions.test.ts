import { describe, expect, it } from 'vitest'
import { project } from './helpers'
import { expectGenerates, generated, INDEX, MAIN_LAYOUT, NEW_POST, nodeOf, POST_CARD } from './behaviour-helpers'
import type { Project } from './behaviour-helpers'

/**
 * B1 (S2, S6): `node_interaction_add`, `_update` and `_remove` on page, layout and component nodes: "when <event> → steps", for the
 * steps and events the generator turns into code (setState, runAction, navigate, toast; click, change, submit, mouseenter, mouseleave).
 */

const UUID = '0b6f6a52-1c7a-4c1e-9a52-7a0e2f3d9b01'
const PAGE_VUE = 'layers/blog/app/pages/index.vue'
const NEW_POST_VUE = 'layers/blog/app/pages/posts/new.vue'

/** A model with the state "reading" ({ dark: boolean, page: integer }) and a Button "n_button_1" on pg_index. */
const base = () => {
  const p = project()
  p.edit('state_create', { name: 'reading', fields: [{ name: 'dark', type: 'boolean', default: false }, { name: 'page', type: 'integer', default: 1 }, { name: 'title', type: 'text', default: '' }] })
  p.edit('node_insert', { file: 'pg_index', parentId: 'n_head', type: 'Button', props: { text: 'Go' } })
  return p
}
const BUTTON = 'n_button_1'
const add = (p: Project, input: Record<string, unknown>) => p.edit('node_interaction_add', { file: 'pg_index', nodeId: BUTTON, ...input })
const refuse = (p: Project, input: Record<string, unknown>, code = 'invalid') => p.refuse('node_interaction_add', { file: 'pg_index', nodeId: BUTTON, ...input }, code)
const interactionsOf = (p: Project, nodeId = BUTTON, path = INDEX) => nodeOf(p, path, nodeId).interactions

describe('node_interaction_add: setState', () => {
  it('adds the interaction and returns its index; the page uses the state under its own name, added in the same edit', () => {
    const p = base()
    const result = add(p, { on: 'click', do: [{ kind: 'setState', state: 'st_reading', field: 'dark', value: true }] })
    expect(result).toMatchObject({ index: 0, addedUses: [{ as: 'reading', state: 'st_reading' }] })
    expect(interactionsOf(p)).toEqual([{ on: 'click', do: [{ kind: 'setState', state: 'st_reading', field: 'dark', value: true }] }])
    expect(p.json(INDEX).uses.state).toEqual([{ as: 'preferences', state: 'st_preferences' }, { as: 'reading', state: 'st_reading' }])
    expect(generated(p.files)[PAGE_VUE]).toContain('@click="setReading({ dark: true })"')
  })

  it('uses the state already used, whatever its name, and says nothing was added', () => {
    const p = base()
    const result = add(p, { on: 'mouseenter', do: [{ kind: 'setState', state: 'st_preferences', field: 'showDrafts', value: true }] })
    expect(result.addedUses).toEqual([])
    expect(p.json(INDEX).uses.state).toHaveLength(1)
  })

  it('takes the control\'s value from a Checkbox change, and the opposite of the current value', () => {
    const p = base()
    p.edit('node_insert', { file: 'pg_index', parentId: 'n_head', type: 'Checkbox', props: { label: 'Dark', value: { $bind: 'preferences.showDrafts' } } })
    p.edit('node_interaction_add', { file: 'pg_index', nodeId: 'n_checkbox_1', on: 'change', do: [{ kind: 'setState', state: 'st_reading', field: 'dark', value: { $event: 'checked' } }] })
    add(p, { on: 'click', do: [{ kind: 'setState', state: 'st_preferences', field: 'showDrafts', value: { not: { $bind: 'preferences.showDrafts' } } }] })
    const vue = generated(p.files)[PAGE_VUE]!
    expect(vue).toContain('@update:model-value="setReading({ dark: $event === true })"')
    expect(vue).toContain('@click="setPreferences({ showDrafts: !preferences.showDrafts })"')
  })

  it('takes the value of another binding in scope, or a template', () => {
    const p = base()
    add(p, { on: 'click', do: [{ kind: 'setState', state: 'st_reading', field: 'title', value: { $template: 'Page {reading.page}' } }] })
    p.edit('node_interaction_add', { file: 'pg_index', nodeId: BUTTON, on: 'mouseenter', do: [{ kind: 'setState', state: 'st_reading', field: 'page', value: { $bind: 'reading.page' } }] })
    expectGenerates(p)
  })

  it('refuses a state or field that does not exist, or a state of shape many', () => {
    const p = base()
    refuse(p, { on: 'click', do: [{ kind: 'setState', state: 'st_nope', field: 'dark', value: true }] }, 'not_found')
    expect(refuse(p, { on: 'click', do: [{ kind: 'setState', state: 'st_reading', field: 'nope', value: true }] }).message).toContain('dark')
    refuse(p, { on: 'click', do: [{ kind: 'setState', state: 'st_reading', field: 'id', value: 'x' }] })
  })

  it('refuses a value that does not fit the field, null, a list, or an expression that is not generated', () => {
    const p = base()
    refuse(p, { on: 'click', do: [{ kind: 'setState', state: 'st_reading', field: 'dark', value: 'yes' }] })
    refuse(p, { on: 'click', do: [{ kind: 'setState', state: 'st_reading', field: 'page', value: 1.5 }] })
    refuse(p, { on: 'click', do: [{ kind: 'setState', state: 'st_reading', field: 'page', value: null }] })
    refuse(p, { on: 'click', do: [{ kind: 'setState', state: 'st_reading', field: 'page', value: [1] }] })
    refuse(p, { on: 'click', do: [{ kind: 'setState', state: 'st_reading', field: 'page', value: { $param: 'x' } }] })
    refuse(p, { on: 'click', do: [{ kind: 'setState', state: 'st_reading', field: 'page', value: { $now: true } }] })
    refuse(p, { on: 'click', do: [{ kind: 'setState', state: 'st_reading', field: 'page', value: {} }] })
    refuse(p, { on: 'click', do: [{ kind: 'setState', state: 'st_reading', field: 'page' }] })
  })

  it('refuses a value that reads something the node cannot read, or a field that is not there', () => {
    const p = base()
    expect(refuse(p, { on: 'click', do: [{ kind: 'setState', state: 'st_reading', field: 'title', value: { $bind: 'nothing.x' } }] }).message).toContain('nothing')
    refuse(p, { on: 'click', do: [{ kind: 'setState', state: 'st_reading', field: 'title', value: { $bind: 'reading.nope' } }] })
    refuse(p, { on: 'click', do: [{ kind: 'setState', state: 'st_reading', field: 'title', value: { $bind: 'post.title' } }] })
    refuse(p, { on: 'click', do: [{ kind: 'setState', state: 'st_reading', field: 'title', value: { $template: 'x {nope.y}' } }] })
    refuse(p, { on: 'click', do: [{ kind: 'setState', state: 'st_reading', field: 'title', value: { $bind: 'all' } }] })
  })

  it('refuses the opposite or the control\'s value for a field that is not true or false', () => {
    const p = base()
    refuse(p, { on: 'click', do: [{ kind: 'setState', state: 'st_reading', field: 'page', value: { not: { $bind: 'reading.dark' } } }] })
  })
})

describe('node_interaction_add: $event', () => {
  it('is generated only as { "$event": "checked" } on the change of a Checkbox, as the one step', () => {
    const p = base()
    p.edit('node_insert', { file: 'pg_index', parentId: 'n_head', type: 'Checkbox', props: { label: 'Dark' } })
    const event = { kind: 'setState', state: 'st_reading', field: 'dark', value: { $event: 'checked' } }
    p.refuse('node_interaction_add', { file: 'pg_index', nodeId: 'n_checkbox_1', on: 'click', do: [event] }, 'invalid')
    refuse(p, { on: 'click', do: [event] })
    p.refuse('node_interaction_add', { file: 'pg_index', nodeId: 'n_checkbox_1', on: 'change', do: [{ ...event, value: { $event: 'value' } }] }, 'invalid')
    p.refuse('node_interaction_add', { file: 'pg_index', nodeId: 'n_checkbox_1', on: 'change', do: [{ kind: 'toast', title: 'x' }, event] }, 'invalid')
    p.refuse('node_interaction_add', { file: 'pg_index', nodeId: 'n_checkbox_1', on: 'change', do: [{ ...event, value: { $event: 'checked' }, extra: 1 }] }, 'invalid')
    p.edit('node_interaction_add', { file: 'pg_index', nodeId: 'n_checkbox_1', on: 'change', do: [event] })
  })

  it('refuses it as a text value or in a setState of a field that is not true or false', () => {
    const p = base()
    p.edit('node_insert', { file: 'pg_index', parentId: 'n_head', type: 'Checkbox', props: { label: 'Dark' } })
    p.refuse('node_interaction_add', { file: 'pg_index', nodeId: 'n_checkbox_1', on: 'change', do: [{ kind: 'setState', state: 'st_reading', field: 'title', value: { $event: 'checked' } }] }, 'invalid')
  })
})

describe('node_interaction_add: runAction', () => {
  const publish = { kind: 'runAction', action: 'act_publish_post', args: { id: UUID } }

  it('adds the interaction and makes the page use the action in the same edit', () => {
    const p = base()
    const result = add(p, { on: 'click', do: [publish] })
    expect(result.addedUses).toEqual([{ as: 'publishPost', action: 'act_publish_post' }])
    expect(p.json(INDEX).uses.actions).toEqual([{ as: 'publishPost', action: 'act_publish_post' }])
    expect(generated(p.files)[PAGE_VUE]).toContain(`@click="publishPost('${UUID}')"`)
  })

  it('adds a second action to a page that already runs one', () => {
    const p = project()
    const result = p.edit('node_interaction_add', { file: 'pg_new_post', nodeId: 'n_cancel', on: 'mouseenter', do: [{ kind: 'runAction', action: 'act_publish_post', args: { id: UUID } }] })
    expect(result.addedUses).toEqual([{ as: 'publishPost', action: 'act_publish_post' }])
    expect(p.json(NEW_POST).uses.actions.map((use: { as: string }) => use.as)).toEqual(['createPost', 'publishPost'])
    expectGenerates(p)
  })

  it('runs a form\'s action with the whole form, on submit, then goes on when it worked', () => {
    const p = project()
    p.edit('node_interaction_update', { file: 'pg_new_post', nodeId: 'n_form', index: 0, do: [
      { kind: 'runAction', action: 'act_create_post', args: { $form: true } },
      { kind: 'toast', when: 'success', title: 'Saved', color: 'success' },
      { kind: 'navigate', when: 'success', to: { page: 'pg_post_detail', params: { slug: { $form: 'slug' } } } }
    ] })
    expect(generated(p.files)[NEW_POST_VUE]).toContain('if (await createPost({ ...form })) {')
  })

  it('refuses an action that does not exist or is not in the page\'s module, and args the action does not take', () => {
    const p = base()
    refuse(p, { on: 'click', do: [{ kind: 'runAction', action: 'act_nope', args: { id: UUID } }] }, 'not_found')
    refuse(p, { on: 'click', do: [{ kind: 'runAction', action: 'act_publish_post' }] })
    refuse(p, { on: 'click', do: [{ kind: 'runAction', action: 'act_publish_post', args: { slug: UUID } }] })
    refuse(p, { on: 'click', do: [{ kind: 'runAction', action: 'act_publish_post', args: { id: UUID, other: 1 } }] })
    refuse(p, { on: 'click', do: [{ kind: 'runAction', action: 'act_publish_post', args: { id: 5 } }] })
    refuse(p, { on: 'click', do: [{ kind: 'runAction', action: 'act_publish_post', args: { $form: true } }] })
    refuse(p, { on: 'click', do: [{ kind: 'runAction', action: 'act_create_post', args: { $form: true } }] })
  })
})

describe('node_interaction_add: navigate and toast', () => {
  it('goes to a page, with its params', () => {
    const p = base()
    add(p, { on: 'click', do: [{ kind: 'navigate', to: { page: 'pg_post_detail', params: { slug: 'hello' } } }] })
    expect(generated(p.files)[PAGE_VUE]).toContain('onButton1Click')
    add(p, { on: 'mouseenter', do: [{ kind: 'navigate', to: { page: 'pg_new_post' } }] })
    expectGenerates(p)
  })

  it('refuses a page that does not exist, a missing or extra param, and a link shape that is not a page', () => {
    const p = base()
    refuse(p, { on: 'click', do: [{ kind: 'navigate', to: { page: 'pg_nope' } }] }, 'not_found')
    expect(refuse(p, { on: 'click', do: [{ kind: 'navigate', to: { page: 'pg_post_detail' } }] }).message).toContain('slug')
    refuse(p, { on: 'click', do: [{ kind: 'navigate', to: { page: 'pg_post_detail', params: { slug: 'a', other: 'b' } } }] })
    refuse(p, { on: 'click', do: [{ kind: 'navigate', to: { page: 'pg_index', params: { slug: 'a' } } }] })
    refuse(p, { on: 'click', do: [{ kind: 'navigate' }] })
    refuse(p, { on: 'click', do: [{ kind: 'navigate', to: 'pg_index' }] })
  })

  it('shows a message', () => {
    const p = base()
    p.edit('page_use_add', { page: 'pg_index', as: 'reading', state: 'st_reading' })
    add(p, { on: 'click', do: [{ kind: 'toast', title: 'Hello', description: { $bind: 'reading.title' }, color: 'success', icon: 'i-lucide-check' }] })
    expect(generated(p.files)[PAGE_VUE]).toContain('toast.add({ title: \'Hello\', description: reading.title, color: \'success\', icon: \'i-lucide-check\' })')
  })

  it('refuses a message with no title, a colour that is not one, or an icon that is not a name', () => {
    const p = base()
    refuse(p, { on: 'click', do: [{ kind: 'toast' }] })
    refuse(p, { on: 'click', do: [{ kind: 'toast', title: 'x', color: 'pink' }] })
    refuse(p, { on: 'click', do: [{ kind: 'toast', title: 'x', icon: 'check' }] })
    refuse(p, { on: 'click', do: [{ kind: 'toast', title: 'x', sound: 'ding' }] })
  })
})

describe('node_interaction_add: steps together', () => {
  it('runs an action, then the steps that follow it when it worked', () => {
    const p = base()
    add(p, { on: 'click', do: [
      { kind: 'runAction', action: 'act_publish_post', args: { id: UUID } },
      { kind: 'toast', when: 'success', title: 'Done' },
      { kind: 'navigate', when: 'success', to: { page: 'pg_new_post' } }
    ] })
    expect(generated(p.files)[PAGE_VUE]).toContain('if (await publishPost(')
  })

  it('runs navigate and toast in order without an action, and an action alone on submit', () => {
    const p = base()
    add(p, { on: 'click', do: [{ kind: 'toast', title: 'Going' }, { kind: 'navigate', to: { page: 'pg_new_post' } }] })
    add(p, { on: 'mouseenter', do: [{ kind: 'navigate', to: { page: 'pg_new_post' } }] })
    expectGenerates(p)
  })

  it('refuses what the generator cannot put in order: a setState with other steps, an action not first, follow-ups that do not wait for success', () => {
    const p = base()
    const set = { kind: 'setState', state: 'st_reading', field: 'dark', value: true }
    const toast = { kind: 'toast', title: 'x' }
    const run = { kind: 'runAction', action: 'act_publish_post', args: { id: UUID } }
    refuse(p, { on: 'click', do: [set, toast] })
    refuse(p, { on: 'click', do: [toast, set] })
    refuse(p, { on: 'click', do: [toast, run] })
    refuse(p, { on: 'click', do: [run, { ...toast }] })
    refuse(p, { on: 'click', do: [run, { ...toast, when: 'failure' }] })
    refuse(p, { on: 'click', do: [{ ...toast, when: 'success' }] })
    refuse(p, { on: 'click', do: [run, set] })
    refuse(p, { on: 'click', do: [run, { ...run, when: 'success' }] })
    refuse(p, { on: 'click', do: [{ ...run, when: 'success' }] })
  })

  it('refuses a setState on submit, since a submit runs a handler of an action, navigate and toast steps', () => {
    const p = project()
    p.edit('state_create', { name: 'reading', fields: [{ name: 'page', type: 'integer', default: 1 }] })
    p.refuse('node_interaction_update', { file: 'pg_new_post', nodeId: 'n_form', index: 0, do: [{ kind: 'setState', state: 'st_reading', field: 'page', value: 2 }] }, 'invalid')
  })
})

describe('node_interaction_add: events and nodes', () => {
  it.each(['click', 'mouseenter', 'mouseleave'])('puts %s on a Button', (on) => {
    const p = base()
    add(p, { on, do: [{ kind: 'toast', title: 'x' }] })
    expectGenerates(p)
  })

  it('refuses appear, and a setVariant step, as not generated yet', () => {
    const p = base()
    expect(refuse(p, { on: 'appear', do: [{ kind: 'toast', title: 'x' }] }).message).toContain('not generated yet')
    expect(refuse(p, { on: 'click', do: [{ kind: 'setVariant', to: '' }] }).message).toContain('not generated yet')
  })

  it('refuses an event the node\'s type has no use for: submit on a Button, change on a Button', () => {
    const p = base()
    refuse(p, { on: 'submit', do: [{ kind: 'toast', title: 'x' }] })
    refuse(p, { on: 'change', do: [{ kind: 'toast', title: 'x' }] })
  })

  it('puts submit and mouse events on a Form, and change on a Checkbox', () => {
    const p = base()
    p.edit('node_interaction_add', { file: 'pg_new_post', nodeId: 'n_form', on: 'mouseenter', do: [{ kind: 'toast', title: 'x' }] })
    p.edit('node_interaction_add', { file: 'pg_new_post', nodeId: 'n_published', on: 'change', do: [{ kind: 'toast', title: 'x' }] })
    p.refuse('node_interaction_add', { file: 'pg_new_post', nodeId: 'n_form', on: 'submit', do: [{ kind: 'toast', title: 'x' }] }, 'invalid')
  })

  it.each(['Container', 'Text', 'Heading', 'Row', 'Grid', 'Card'])('refuses a %s: the generator puts no event on it yet', (type) => {
    const p = project()
    const id = p.edit('node_insert', { file: 'pg_index', type }).nodeId as string
    expect(p.refuse('node_interaction_add', { file: 'pg_index', nodeId: id, on: 'click', do: [{ kind: 'toast', title: 'x' }] }, 'invalid').message).toContain('not generated yet')
  })

  it('refuses a node that is not there, a file that is not a tree, an interaction twice for one event, and no steps', () => {
    const p = base()
    p.refuse('node_interaction_add', { file: 'pg_index', nodeId: 'n_nope', on: 'click', do: [{ kind: 'toast', title: 'x' }] }, 'not_found')
    p.refuse('node_interaction_add', { file: 'pg_nope', nodeId: BUTTON, on: 'click', do: [{ kind: 'toast', title: 'x' }] }, 'not_found')
    p.refuse('node_interaction_add', { file: 'pg_index', nodeId: BUTTON, on: 'click', do: [] }, 'invalid_input')
    p.refuse('node_interaction_add', { file: 'pg_index', nodeId: BUTTON, on: 'hover', do: [{ kind: 'toast', title: 'x' }] }, 'invalid_input')
    add(p, { on: 'click', do: [{ kind: 'toast', title: 'x' }] })
    expect(refuse(p, { on: 'click', do: [{ kind: 'toast', title: 'y' }] }).message).toContain('index 0')
  })

  it('writes only the page file, and keeps the other interactions of the node in order', () => {
    const p = base()
    add(p, { on: 'click', do: [{ kind: 'toast', title: 'x' }] })
    const second = add(p, { on: 'mouseenter', do: [{ kind: 'toast', title: 'y' }] })
    expect(second.index).toBe(1)
    expect((second.changes as Array<{ path: string }>).map(change => change.path)).toEqual([INDEX])
    expect(interactionsOf(p).map((entry: { on: string }) => entry.on)).toEqual(['click', 'mouseenter'])
  })
})

describe('node_interaction_add: layouts and components', () => {
  it('puts navigate and toast steps on a layout node, and on a component node, beside the variant interactions', () => {
    const p = project()
    const button = p.edit('node_insert', { file: 'lay_main', parentId: 'n_nav', type: 'Button', props: { text: 'Write' } }).nodeId as string
    p.edit('node_interaction_add', { file: 'lay_main', nodeId: button, on: 'click', do: [{ kind: 'navigate', to: { page: 'pg_new_post' } }] })
    expect(nodeOf(p, MAIN_LAYOUT, button).interactions).toHaveLength(1)
    const inner = p.edit('node_insert', { file: 'cmp_post_card', parentId: 'n_actions', type: 'Button', props: { text: 'Hi' } }).nodeId as string
    p.edit('node_interaction_add', { file: 'cmp_post_card', nodeId: inner, on: 'click', do: [{ kind: 'toast', title: 'Hi' }] })
    p.edit('component_variant_add', { component: 'cmp_post_card', name: 'pressed' })
    p.edit('component_interaction_add', { component: 'cmp_post_card', variant: '', on: 'click', to: p.json(POST_CARD).variants.at(-1).id })
    const card = p.json(POST_CARD)
    expect(card.interactions).toHaveLength(1)
    expect(nodeOf(p, POST_CARD, inner).interactions).toHaveLength(1)
    expectGenerates(p)
  })

  it('refuses a step a layout or a component has nothing for: state and actions are used by pages', () => {
    const p = project()
    const button = p.edit('node_insert', { file: 'lay_main', parentId: 'n_nav', type: 'Button', props: { text: 'Write' } }).nodeId as string
    const inner = p.edit('node_insert', { file: 'cmp_post_card', parentId: 'n_actions', type: 'Button', props: { text: 'Hi' } }).nodeId as string
    for (const [file, nodeId] of [['lay_main', button], ['cmp_post_card', inner]]) {
      const set = p.refuse('node_interaction_add', { file, nodeId, on: 'click', do: [{ kind: 'setState', state: 'st_preferences', field: 'showDrafts', value: true }] }, 'invalid')
      expect(set.message).toContain('not generated yet')
      p.refuse('node_interaction_add', { file, nodeId, on: 'click', do: [{ kind: 'runAction', action: 'act_publish_post', args: { id: UUID } }] }, 'invalid')
    }
  })

  it('reads what a layout or component can read in a step: its variables and properties, nothing of a page', () => {
    const p = project()
    const inner = p.edit('node_insert', { file: 'cmp_post_card', parentId: 'n_actions', type: 'Button', props: { text: 'Hi' } }).nodeId as string
    p.edit('node_interaction_add', { file: 'cmp_post_card', nodeId: inner, on: 'click', do: [{ kind: 'toast', title: { $bind: 'draftLabel' } }] })
    p.refuse('node_interaction_add', { file: 'cmp_post_card', nodeId: inner, on: 'mouseenter', do: [{ kind: 'toast', title: { $bind: 'all' } }] }, 'invalid')
    p.refuse('node_interaction_add', { file: 'cmp_post_card', nodeId: inner, on: 'mouseleave', do: [{ kind: 'toast', title: { $route: 'slug' } }] }, 'invalid')
    expectGenerates(p)
  })
})

describe('node_interaction_update and node_interaction_remove', () => {
  const withOne = () => {
    const p = base()
    add(p, { on: 'click', do: [{ kind: 'toast', title: 'x' }] })
    return p
  }

  it('changes the event, the steps, or both, in place', () => {
    const p = withOne()
    add(p, { on: 'mouseenter', do: [{ kind: 'toast', title: 'y' }] })
    p.edit('node_interaction_update', { file: 'pg_index', nodeId: BUTTON, index: 0, on: 'mouseleave' })
    expect(interactionsOf(p)[0]).toEqual({ on: 'mouseleave', do: [{ kind: 'toast', title: 'x' }] })
    p.edit('node_interaction_update', { file: 'pg_index', nodeId: BUTTON, index: 1, do: [{ kind: 'setState', state: 'st_reading', field: 'dark', value: true }] })
    expect(interactionsOf(p)[1]).toEqual({ on: 'mouseenter', do: [{ kind: 'setState', state: 'st_reading', field: 'dark', value: true }] })
    expect(p.json(INDEX).uses.state.map((use: { as: string }) => use.as)).toContain('reading')
    expectGenerates(p)
  })

  it('applies the rules of an add: events of the node, one per event, steps the generator builds', () => {
    const p = withOne()
    add(p, { on: 'mouseenter', do: [{ kind: 'toast', title: 'y' }] })
    p.refuse('node_interaction_update', { file: 'pg_index', nodeId: BUTTON, index: 1, on: 'click' }, 'invalid')
    p.refuse('node_interaction_update', { file: 'pg_index', nodeId: BUTTON, index: 1, on: 'appear' }, 'invalid')
    p.refuse('node_interaction_update', { file: 'pg_index', nodeId: BUTTON, index: 0, on: 'submit' }, 'invalid')
    p.refuse('node_interaction_update', { file: 'pg_index', nodeId: BUTTON, index: 0, do: [{ kind: 'setVariant', to: '' }] }, 'invalid')
    p.refuse('node_interaction_update', { file: 'pg_index', nodeId: BUTTON, index: 0 }, 'invalid')
    p.edit('node_interaction_update', { file: 'pg_index', nodeId: BUTTON, index: 0, on: 'click' })
  })

  it('refuses an index that is not there, and a node that is not', () => {
    const p = withOne()
    p.refuse('node_interaction_update', { file: 'pg_index', nodeId: BUTTON, index: 3, on: 'mouseenter' }, 'not_found')
    p.refuse('node_interaction_remove', { file: 'pg_index', nodeId: BUTTON, index: 3 }, 'not_found')
    p.refuse('node_interaction_remove', { file: 'pg_index', nodeId: 'n_nope', index: 0 }, 'not_found')
    p.refuse('node_interaction_remove', { file: 'pg_index', nodeId: 'n_h1', index: 0 }, 'not_found')
  })

  it('removes an interaction, and the key when it was the last', () => {
    const p = withOne()
    add(p, { on: 'mouseenter', do: [{ kind: 'toast', title: 'y' }] })
    p.edit('node_interaction_remove', { file: 'pg_index', nodeId: BUTTON, index: 0 })
    expect(interactionsOf(p)).toEqual([{ on: 'mouseenter', do: [{ kind: 'toast', title: 'y' }] }])
    p.edit('node_interaction_remove', { file: 'pg_index', nodeId: BUTTON, index: 0 })
    expect(nodeOf(p, INDEX, BUTTON).interactions).toBeUndefined()
    expectGenerates(p)
  })

  it('removes the golden checkbox\'s interaction, and the page generates without it', () => {
    const p = project()
    p.edit('node_interaction_remove', { file: 'pg_index', nodeId: 'n_toggle', index: 0 })
    expect(nodeOf(p, INDEX, 'n_toggle').interactions).toBeUndefined()
    expectGenerates(p)
  })
})

describe('what interactions mean for state, actions and pages', () => {
  it('stops a state field a step sets from changing, a state from being deleted, and a use from being removed', () => {
    const p = project()
    p.edit('state_create', { name: 'reading', fields: [{ name: 'page', type: 'integer', default: 1 }] })
    p.edit('node_interaction_add', { file: 'pg_new_post', nodeId: 'n_cancel', on: 'mouseenter', do: [{ kind: 'setState', state: 'st_reading', field: 'page', value: 2 }] })
    const update = p.refuse('state_update', { state: 'st_reading', fields: [{ name: 'chapter', type: 'integer', default: 1 }] }, 'invalid').message
    expect(update).toContain('pg_new_post')
    expect(update).toContain('page')
    expect(p.refuse('state_delete', { state: 'st_reading' }, 'invalid').message).toContain('pg_new_post')
    expect(p.refuse('page_use_remove', { page: 'pg_new_post', state: 'st_reading' }, 'invalid').message).toContain('n_cancel')
    // Removing the last step that sets the state drops the use it added, so the state can go (B1 verification, item 8).
    expect(p.edit('node_interaction_remove', { file: 'pg_new_post', nodeId: 'n_cancel', index: 1 }).droppedUses).toEqual([{ as: 'reading', state: 'st_reading' }])
    p.edit('state_delete', { state: 'st_reading' })
  })

  it('stops a page from being deleted while a step navigates to it, and an action while a step runs it', () => {
    const p = base()
    add(p, { on: 'click', do: [{ kind: 'navigate', to: { page: 'pg_new_post' } }] })
    p.refuse('page_delete', { page: 'pg_new_post' }, 'invalid')
    add(p, { on: 'mouseenter', do: [{ kind: 'runAction', action: 'act_publish_post', args: { id: UUID } }] })
    p.refuse('action_delete', { action: 'act_publish_post' }, 'invalid')
    p.refuse('page_use_remove', { page: 'pg_index', as: 'publishPost' }, 'invalid')
  })
})
