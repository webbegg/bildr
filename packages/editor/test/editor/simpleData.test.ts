import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, reactive } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { mount } from '@vue/test-utils'
import { applyEdit } from '@bildr/codegen/edit'
import type { EditName } from '@bildr/codegen/edit'
import { loadModel, serializeModel } from '@bildr/codegen/model'
import { Failure, click, mockActions, mountWithApp, settle, typeInto } from '../helpers.ts'
import { takeStart } from '../../src/editor/views.ts'
import { useAdvancedHandoff } from '../../src/editor/useSimpleData.ts'
import { routes } from '../../src/router.ts'
import App from '../../src/App.vue'
import DataView from '../../src/views/DataView.vue'
import SimpleDataView from '../../src/views/SimpleDataView.vue'
import { FakeEventSource, baseHandlers, combo, inputOf, setupHarness, world } from '../design/harness.ts'
import type { Handlers } from '../design/harness.ts'
import { confirmText, inputs, q, qa, stateModule, text } from './dataKit.ts'

/**
 * The simple Data section (simple data, S2, S3), mounted as the screen at `/data` over the mocked actions, whose `state_*` edits are the
 * module's own (`stateModule`): the list with its State and APIs sections and their empty states, a store's form (its persistence and its
 * fields, saved or discarded together), and creating, renaming and deleting a store. The blog fixture has one store, `preferences`
 * ("Blog preferences", kept in this browser, one toggle `showDrafts`), which the index page binds and a checkbox sets.
 */

setupHarness()

afterEach(() => {
  takeStart()
})

/** Applies one of the module's own edits to the mocked model, as an earlier save would have. */
const seed = (name: EditName, input: Record<string, unknown>) => {
  const files = serializeModel(world.model)
  const outcome = applyEdit(files, name, input)
  if (!outcome.ok) throw new Error(outcome.message)
  const next = { ...files }
  for (const change of outcome.changes) {
    if (change.content === null) Reflect.deleteProperty(next, change.path)
    else next[change.path] = change.content
  }
  const loaded = loadModel(next)
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.problems))
  world.model = loaded.model
  return outcome.result as Record<string, unknown>
}
const addApi = () => seed('api_create', { name: 'Shop API', baseUrl: 'https://api.example.com/v1' }).datasourceId as string
const addStore = (name = 'cart') => seed('state_create', { name }).stateId as string

const mounted = async (extra: Handlers = {}, path = '/data') => {
  const actions = mockActions({ ...baseHandlers(), env_status: () => ({ variables: [] }), ...stateModule(), ...extra })
  const screen = await mountWithApp(SimpleDataView, path)
  return { actions, ...screen }
}
const calls = (actions: Awaited<ReturnType<typeof mounted>>['actions'], name: string) => inputs(actions, name)
const store = (id: string) => q(`[data-simple-store="${id}"]`)
const stored = (id = 'st_preferences') => world.model.modules.blog!.state.find(entry => entry.id === id)!
const rows = () => qa('[data-simple-field]')
const row = (id: string) => q(`[data-simple-field="${id}"]`)!
const last = () => rows().at(-1)!
const inRow = (element: Element, hook: string) => element.querySelector<HTMLElement>(`[${hook}]`)!
const textButton = (label: string) => qa('button').find(candidate => candidate.textContent?.trim() === label) ?? null

/** Picks the option whose text is exactly `label`. */
const pick = async (trigger: Element, label: string) => {
  trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await settle()
  const option = qa('[role="option"]').find(element => element.textContent?.trim() === label)
  if (!option) throw new Error(`no option ${label}`)
  option.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }))
  option.click()
  await settle()
}
const addField = async (name: string, type?: string, value?: string) => {
  await click(q('[data-simple-field-add]'))
  await typeInto(inputOf(`[data-simple-field="${last().getAttribute('data-simple-field')}"] [data-simple-field-name]`), name)
  if (type) await pick(combo(`[data-simple-field="${last().getAttribute('data-simple-field')}"] [data-simple-field-type]`), type)
  if (value !== undefined) await typeInto(inputOf(`[data-simple-field="${last().getAttribute('data-simple-field')}"] [data-simple-field-default]`), value)
}
const save = () => click(q('[data-simple-state-save]'))

describe('the list of the simple Data section', () => {
  it('has a State section with every store and an APIs section with every API, each with its base URL host', async () => {
    addApi()
    await mounted()
    expect(q('[data-testid="simple-data"]')).not.toBeNull()
    expect(q('[data-view-menu]')?.textContent?.trim()).toBe('Data')
    expect(text(q('[data-simple-section="state"] h2'))).toBe('Stores')
    expect(text(q('[data-simple-section="apis"] h2'))).toBe('APIs')
    expect(qa('[data-simple-section="state"] [data-simple-store]').map(item => item.getAttribute('data-simple-store'))).toEqual(['st_preferences'])
    expect(text(store('st_preferences'))).toContain('Blog preferences')
    const api = q('[data-simple-api="ds_shop_api"]')
    expect(text(api)).toContain('shop-api')
    expect(text(api)).toContain('api.example.com')
    expect(text(api)).not.toContain('https://')
  })

  it('shows a polished empty state in each section, and a + to make an API', async () => {
    world.model.modules.blog!.state = []
    world.model.datasources = world.model.datasources.filter(source => source.kind !== 'api')
    await mounted()
    expect(text(q('[data-simple-empty="state"]'))).toContain('No stores yet')
    expect(text(q('[data-simple-empty="apis"]'))).toContain('No APIs yet')
    expect(q('[data-simple-empty="state"] [data-simple-empty-new]')).not.toBeNull()
    expect(q('[data-simple-section="apis"] [data-simple-new-api]')).not.toBeNull()
  })

  it('shows the API\'s panel, with its name and its base URL, when an API is chosen', async () => {
    addApi()
    const { router } = await mounted()
    await click(q('[data-simple-api="ds_shop_api"]'))
    const panel = q('[data-simple-api-panel]')
    expect(text(panel)).toContain('shop-api')
    expect(inputOf('[data-api-name]').value).toBe('shop-api')
    expect(inputOf('[data-api-baseurl]').value).toBe('https://api.example.com/v1')
    expect(router.currentRoute.value.query).toEqual({ item: 'api:ds_shop_api' })
  })

  it('opens the store a link names, and puts the store chosen in the URL', async () => {
    addStore()
    const { router } = await mounted({}, '/data?item=state:st_cart')
    expect(q('[data-simple-store-form]')?.getAttribute('data-simple-store-form')).toBe('st_cart')
    await click(store('st_preferences'))
    expect(q('[data-simple-store-form]')?.getAttribute('data-simple-store-form')).toBe('st_preferences')
    expect(router.currentRoute.value.query).toEqual({ item: 'state:st_preferences' })
  })

  it('asks for something to be chosen while nothing is', async () => {
    await mounted()
    expect(q('[data-simple-store-form]')).toBeNull()
    expect(q('[data-simple-nothing]')).not.toBeNull()
  })
})

/** What the section says in words, wherever the user reads it: its text and the text of its labels, titles and placeholders. */
const said = () => [
  document.body.textContent ?? '',
  ...qa('[aria-label], [title], [placeholder]').flatMap(element => ['aria-label', 'title', 'placeholder'].map(name => element.getAttribute(name) ?? ''))
].join(' ')
/** The words of the model's code and of the advanced workspace, which the simple section does not use. */
const JARGON = /\b(state|composable|collection|entity|artifact|datasource|data source)\b/i
const COMPOSABLE = /\buse[A-Z][A-Za-z0-9]+/
const CAMEL = /\b[a-z]+[A-Z][A-Za-z]*\b/

describe('the words of the simple section', () => {
  it('are plain everywhere it shows: the list, the forms, the dialogs and the refusals', async () => {
    addApi()
    addStore()
    await mounted()
    const seen: Array<[string, string]> = []
    const note = (what: string) => seen.push([what, said()])
    const cancel = async () => click(textButton('Cancel'))
    note('the list')

    await click(store('st_preferences'))
    note('a store\'s form')
    await click(inRow(row('fld_show_drafts'), 'data-field-uses'))
    note('the places a field is used')
    await click(inRow(row('fld_show_drafts'), 'data-simple-field-remove'))
    note('the field a page uses can\'t be removed')
    await click(q('[data-confirm-cancel]'))
    await typeInto(inputOf('[data-simple-field="fld_show_drafts"] [data-simple-field-name]'), 'showAll')
    await save()
    note('the refusal next to a field')
    await click(q('[data-simple-state-discard]'))

    await click(q('[data-simple-rename]'))
    note('the Rename dialog')
    await typeInto(inputOf('[data-artifact-dialog="rename"] [data-artifact-name]'), 'posts')
    await click(q('[data-artifact-submit]'))
    expect(text(q('[data-artifact-dialog="rename"] [data-artifact-error]'))).not.toBe('')
    note('a refused rename')
    await cancel()

    await click(q('[data-simple-delete]'))
    note('the Delete dialog of a store a page uses')
    await cancel()
    await click(store('st_cart'))
    await click(q('[data-simple-delete]'))
    note('the Delete dialog of a store nothing uses')
    await cancel()

    await click(q('[data-simple-new-store]'))
    note('the New store form')
    await typeInto(inputOf('[data-simple-name]'), 'posts')
    await click(q('[data-simple-create-submit]'))
    expect(text(q('[data-simple-create-error]'))).not.toBe('')
    note('a refused name: taken by data')
    await typeInto(inputOf('[data-simple-name]'), 'preferences')
    await click(q('[data-simple-create-submit]'))
    expect(text(q('[data-simple-create-error]'))).not.toBe('')
    note('a refused name: a store has it')

    for (const [what, words] of seen) {
      expect(words, what).not.toMatch(JARGON)
      expect(words, what).not.toMatch(COMPOSABLE)
    }
  })

  it('use no camelCase example in what they explain: the help and the placeholders', async () => {
    await mounted()
    await click(q('[data-simple-new-store]'))
    // The words of each element apart (their text, joined, would run labels into the help below them).
    const apart = (element: Element | null) => (element?.innerHTML ?? '').replace(/<[^>]*>/g, ' ')
    const help = [apart(q('[data-simple-create]')), ...qa('[data-simple-create] [placeholder]').map(element => element.getAttribute('placeholder') ?? '')].join(' ')
    expect(help).not.toMatch(CAMEL)
    await click(store('st_preferences'))
    const placeholder = inputOf('[data-simple-field-name]').placeholder
    expect(placeholder).toBe('Name, e.g. Show drafts')
    expect(placeholder).not.toMatch(CAMEL)
  })

  it('call it a store, in the list and in the dialogs\' titles', async () => {
    await mounted({}, '/data?item=state:st_preferences')
    expect(text(q('[data-simple-section="state"] h2'))).toBe('Stores')
    await click(q('[data-simple-rename]'))
    expect(text(q('[role="dialog"] h2, [role="dialog"] [data-slot="title"]'))).toBe('Rename store')
    await click(textButton('Cancel'))
    await click(q('[data-simple-delete]'))
    expect(text(q('[role="dialog"] h2, [role="dialog"] [data-slot="title"]'))).toBe('Delete store')
  })
})

describe('a store changed, removed or renamed elsewhere while its form has edits', () => {
  const FILE = '.bildr/modules/blog/state/preferences.json'
  let version = 200
  /** Another editor, a rename, an undo or a JSON-tab save: the model has a different store, and the editor reads it. */
  const outside = async (change: () => void) => {
    change()
    FakeEventSource.instances.at(-1)!.send({ type: 'model', version: version++, files: [FILE], source: 'disk' })
    await settle()
  }
  const OPEN = '/data?item=state:st_preferences'
  const checkbox = () => inRow(row('fld_show_drafts'), 'data-simple-field-default') as HTMLInputElement

  it('changed: says so, keeps the edits and blocks Save until the user chooses', async () => {
    const { actions } = await mounted({}, OPEN)
    await addField('search', 'Text')
    await outside(() => {
      stored().fields[0]!.default = true
    })
    expect(text(q('[data-simple-state-changed]'))).toContain('This store changed since you started editing')
    expect(textButton('Load the new version')).not.toBeNull()
    expect(textButton('Keep my edits')).not.toBeNull()
    expect(rows()).toHaveLength(2)
    expect(q('[data-simple-state-save]')?.hasAttribute('disabled')).toBe(true)
    await save()
    expect(calls(actions, 'state_update')).toEqual([])
  })

  it('changed: shows no notice while nothing was edited, and follows the model', async () => {
    await mounted({}, OPEN)
    await outside(() => {
      stored().fields[0]!.default = true
    })
    expect(q('[data-simple-state-changed]')).toBeNull()
    expect(checkbox().checked).toBe(true)
  })

  it('changed: "Load the new version" drops the edits and shows the new store', async () => {
    const { actions } = await mounted({}, OPEN)
    await addField('search', 'Text')
    await outside(() => {
      stored().fields[0]!.default = true
    })
    await click(textButton('Load the new version'))
    expect(q('[data-simple-state-changed]')).toBeNull()
    expect(rows()).toHaveLength(1)
    expect(checkbox().checked).toBe(true)
    expect(q('[data-simple-state-unsaved]')).toBeNull()
    expect(calls(actions, 'state_update')).toEqual([])
  })

  it('changed: "Keep my edits" keeps them over the new store, and saves them with what changed elsewhere', async () => {
    const { actions } = await mounted({}, OPEN)
    await addField('search', 'Text')
    await outside(() => {
      stored().fields[0]!.default = true
    })
    await click(textButton('Keep my edits'))
    expect(q('[data-simple-state-changed]')).toBeNull()
    expect(rows()).toHaveLength(2)
    expect(checkbox().checked).toBe(true)
    await save()
    expect(calls(actions, 'state_update')).toEqual([{
      state: 'st_preferences',
      fields: [{ id: 'fld_show_drafts', name: 'showDrafts', type: 'boolean', default: true }, { name: 'search', type: 'text' }]
    }])
  })

  it('changed: a change of how long it keeps its values counts, and "Keep my edits" takes the new one when it was not touched', async () => {
    await mounted({}, OPEN)
    await addField('search', 'Text')
    await outside(() => {
      stored().persist = 'session'
    })
    expect(q('[data-simple-state-changed]')).not.toBeNull()
    await click(textButton('Keep my edits'))
    expect(q('[data-simple-persist="session"]')?.getAttribute('aria-checked')).toBe('true')
    expect(rows()).toHaveLength(2)
  })

  it('deleted: keeps the edits, says the store was deleted and has nothing to save them to', async () => {
    addStore()
    const { actions } = await mounted({}, '/data?item=state:st_cart')
    await addField('search', 'Text')
    await outside(() => {
      world.model.modules.blog!.state = world.model.modules.blog!.state.filter(entry => entry.id !== 'st_cart')
    })
    expect(text(q('[data-simple-state-removed]'))).toContain('This store was deleted')
    expect(q('[data-simple-store-form]')?.getAttribute('data-simple-store-form')).toBe('st_cart')
    expect(rows()).toHaveLength(2)
    expect(store('st_cart')).toBeNull()
    expect(q('[data-simple-state-unsaved]')).not.toBeNull()
    expect(q('[data-simple-state-save]')?.hasAttribute('disabled')).toBe(true)
    await save()
    expect(calls(actions, 'state_update')).toEqual([])
  })

  it('deleted: asks before another store is shown, and closes once the edits are discarded', async () => {
    addStore()
    await mounted({}, '/data?item=state:st_cart')
    await addField('search', 'Text')
    await outside(() => {
      world.model.modules.blog!.state = world.model.modules.blog!.state.filter(entry => entry.id !== 'st_cart')
    })
    await click(store('st_preferences'))
    expect(confirmText()).toContain('Discard unsaved changes to Cart?')
    await click(q('[data-confirm-cancel]'))
    expect(q('[data-simple-store-form]')?.getAttribute('data-simple-store-form')).toBe('st_cart')
    expect(rows()).toHaveLength(2)
    await click(q('[data-simple-state-discard]'))
    expect(q('[data-simple-store-form]')).toBeNull()
    expect(q('[data-simple-state-removed]')).toBeNull()
  })

  it('deleted: the form just goes when nothing was edited', async () => {
    addStore()
    await mounted({}, '/data?item=state:st_cart')
    await outside(() => {
      world.model.modules.blog!.state = world.model.modules.blog!.state.filter(entry => entry.id !== 'st_cart')
    })
    expect(q('[data-simple-store-form]')).toBeNull()
    expect(q('[data-simple-state-removed]')).toBeNull()
  })

  it('renamed: says so, keeps the edits on the renamed store and saves them to it', async () => {
    addStore()
    const { actions } = await mounted({}, '/data?item=state:st_cart')
    await addField('search', 'Text')
    await outside(() => {
      stored('st_cart').name = 'basket'
    })
    expect(text(q('[data-simple-state-renamed]'))).toContain('This store was renamed')
    expect(q('[data-simple-store-form]')?.getAttribute('data-simple-store-form')).toBe('st_cart')
    expect(q('[data-simple-state-changed]')).toBeNull()
    expect(rows()).toHaveLength(2)
    await save()
    const sent = calls(actions, 'state_update')
    expect(sent).toHaveLength(1)
    expect(sent[0]!.state).toBe('st_cart')
    expect(stored('st_cart').name).toBe('basket')
    expect(stored('st_cart').fields.map(field => field.name)).toEqual(['value', 'search'])
    expect(q('[data-simple-state-renamed]')).toBeNull()
  })

  it('renamed: shows no notice when nothing was edited', async () => {
    addStore()
    await mounted({}, '/data?item=state:st_cart')
    await outside(() => {
      stored('st_cart').name = 'basket'
    })
    expect(q('[data-simple-state-renamed]')).toBeNull()
    expect(q('[data-simple-store-form]')?.getAttribute('data-simple-store-form')).toBe('st_cart')
  })
})

describe('creating a store', () => {
  it('asks for a name, how long it keeps its values and says it holds one set of values, then makes it with state_create and shows it', async () => {
    const { actions, router } = await mounted()
    await click(q('[data-simple-new-store]'))
    expect(q('[data-simple-create]')).not.toBeNull()
    expect(q('[data-simple-persist="memory"]')?.getAttribute('aria-checked')).toBe('true')
    expect(text(q('[data-simple-shape]'))).toContain('One set of values')
    expect(q('[data-simple-create-submit]')?.hasAttribute('disabled')).toBe(true)
    await typeInto(inputOf('[data-simple-name]'), 'cart')
    await click(q('[data-simple-persist="session"]'))
    await click(q('[data-simple-create-submit]'))
    expect(calls(actions, 'state_create')).toEqual([{ name: 'cart', persist: 'session' }])
    expect(q('[data-simple-store-form]')?.getAttribute('data-simple-store-form')).toBe('st_cart')
    expect(store('st_cart')).not.toBeNull()
    expect(stored('st_cart').persist).toBe('session')
    expect(router.currentRoute.value.query).toEqual({ item: 'state:st_cart' })
    expect(q('[data-simple-create]')).toBeNull()
  })

  it('uses the plain labels of how long a store keeps its values', async () => {
    await mounted()
    await click(q('[data-simple-new-store]'))
    const said = text(q('[data-simple-create]'))
    expect(said).toContain('Forgotten on reload')
    expect(said).toContain('Kept for this tab')
    expect(said).toContain('Kept in this browser')
  })

  it('shows what the module refuses in the form and keeps what was typed', async () => {
    const { actions } = await mounted()
    await click(q('[data-simple-new-store]'))
    await typeInto(inputOf('[data-simple-name]'), 'preferences')
    await click(q('[data-simple-create-submit]'))
    expect(calls(actions, 'state_create')).toHaveLength(1)
    expect(text(q('[data-simple-create-error]'))).toMatch(/preferences/)
    expect(inputOf('[data-simple-name]').value).toBe('preferences')
    expect(q('[data-simple-create]')).not.toBeNull()
  })

  it('can be cancelled', async () => {
    await mounted()
    await click(q('[data-simple-new-store]'))
    await click(q('[data-simple-create-cancel]'))
    expect(q('[data-simple-create]')).toBeNull()
  })

  it('is offered from the empty State section too', async () => {
    world.model.modules.blog!.state = []
    await mounted()
    await click(q('[data-simple-empty="state"] [data-simple-empty-new]'))
    expect(q('[data-simple-create]')).not.toBeNull()
  })
})

describe('a store\'s form', () => {
  const OPEN = '/data?item=state:st_preferences'

  it('shows how long it keeps its values and its fields', async () => {
    await mounted({}, OPEN)
    expect(text(q('[data-simple-title]'))).toBe('Blog preferences')
    expect(q('[data-simple-persist="localStorage"]')?.getAttribute('aria-checked')).toBe('true')
    expect(text(q('[data-simple-shape]'))).toContain('One set of values')
    expect(inputOf('[data-simple-field="fld_show_drafts"] [data-simple-field-name]').value).toBe('showDrafts')
    expect(text(inRow(row('fld_show_drafts'), 'data-simple-field-type'))).toContain('Toggle')
    expect(q('[data-simple-state-save]')?.hasAttribute('disabled')).toBe(true)
  })

  it('adds a field and saves it with the whole list in one state_update, then shows it after a reload', async () => {
    const { actions, wrapper } = await mounted({}, OPEN)
    await addField('search', 'Text', 'hello')
    expect(q('[data-simple-state-unsaved]')).not.toBeNull()
    expect(calls(actions, 'state_update')).toEqual([])
    await save()
    expect(calls(actions, 'state_update')).toEqual([{
      state: 'st_preferences',
      fields: [
        { id: 'fld_show_drafts', name: 'showDrafts', type: 'boolean', default: false },
        { name: 'search', type: 'text', default: 'hello' }
      ]
    }])
    expect(stored().fields.map(field => field.name)).toEqual(['showDrafts', 'search'])
    expect(q('[data-simple-state-unsaved]')).toBeNull()
    expect(rows()).toHaveLength(2)
    wrapper.unmount()
    await mountWithApp(SimpleDataView, OPEN)
    expect(rows()).toHaveLength(2)
    expect(inputOf('[data-simple-field] + [data-simple-field] [data-simple-field-name]').value).toBe('search')
  })

  it('saves a change of how long it keeps its values with the fields, in the same call', async () => {
    const { actions } = await mounted({}, OPEN)
    await click(q('[data-simple-persist="session"]'))
    await addField('search', 'Text')
    await save()
    const sent = calls(actions, 'state_update')
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ state: 'st_preferences', persist: 'session' })
    expect((sent[0]!.fields as Array<{ name: string }>).map(field => field.name)).toEqual(['showDrafts', 'search'])
    expect(stored().persist).toBe('session')
  })

  it('saves only the persistence when only it changed', async () => {
    const { actions } = await mounted({}, OPEN)
    await click(q('[data-simple-persist="memory"]'))
    await save()
    expect(calls(actions, 'state_update')).toEqual([{ state: 'st_preferences', persist: 'memory' }])
  })

  it('discards the edits, and writes nothing', async () => {
    const { actions } = await mounted({}, OPEN)
    await click(q('[data-simple-persist="session"]'))
    await addField('search', 'Text')
    await typeInto(inputOf('[data-simple-field="fld_show_drafts"] [data-simple-field-name]'), 'showAll')
    expect(rows()).toHaveLength(2)
    await click(q('[data-simple-state-discard]'))
    expect(rows()).toHaveLength(1)
    expect(inputOf('[data-simple-field="fld_show_drafts"] [data-simple-field-name]').value).toBe('showDrafts')
    expect(q('[data-simple-persist="localStorage"]')?.getAttribute('aria-checked')).toBe('true')
    expect(q('[data-simple-state-unsaved]')).toBeNull()
    expect(calls(actions, 'state_update')).toEqual([])
  })

  it('does not send a default that does not fit, and says which', async () => {
    const { actions } = await mounted({}, OPEN)
    await addField('perPage', 'Integer', '1.5')
    await save()
    expect(calls(actions, 'state_update')).toEqual([])
    expect(text(q('[data-simple-state-error]'))).toBe('perPage: its default is a whole number')
  })

  it('shows what the module refused next to the field it is about, and keeps the edits', async () => {
    const { actions } = await mounted({}, OPEN)
    await typeInto(inputOf('[data-simple-field="fld_show_drafts"] [data-simple-field-name]'), 'showAll')
    await save()
    expect(calls(actions, 'state_update')).toHaveLength(1)
    expect(text(row('fld_show_drafts').querySelector('[data-simple-field-error]'))).toContain('showDrafts')
    expect(inputOf('[data-simple-field="fld_show_drafts"] [data-simple-field-name]').value).toBe('showAll')
    expect(stored().fields[0]!.name).toBe('showDrafts')
  })

  it('shows what the module refused about the store in the footer', async () => {
    await mounted({ state_update: () => new Failure(422, 'invalid', 'The state can\'t be saved right now') }, OPEN)
    await click(q('[data-simple-persist="session"]'))
    await save()
    // In the section's words: a store.
    expect(text(q('[data-simple-state-error]'))).toBe('The store can\'t be saved right now')
    expect(q('[data-simple-state-unsaved]')).not.toBeNull()
  })

  it('removes a field it just added without asking, and warns before one a page uses is removed, keeping it', async () => {
    const { actions } = await mounted({}, OPEN)
    await addField('search', 'Text')
    await click(inRow(last(), 'data-simple-field-remove'))
    expect(rows()).toHaveLength(1)
    expect(q('[data-confirm]')).toBeNull()
    await click(inRow(row('fld_show_drafts'), 'data-simple-field-remove'))
    expect(confirmText()).toContain('“showDrafts” is used in 1 place')
    await click(q('[data-confirm-cancel]'))
    expect(rows()).toHaveLength(1)
    expect(calls(actions, 'state_update')).toEqual([])
  })

  it('says how many places use a field', async () => {
    await mounted({}, OPEN)
    expect(text(inRow(row('fld_show_drafts'), 'data-field-uses'))).toBe('1')
  })

  it('asks before leaving it with edits, and keeps them when the user keeps them', async () => {
    addStore()
    const { actions } = await mounted({}, OPEN)
    await addField('search', 'Text')
    await click(store('st_cart'))
    expect(confirmText()).toContain('Discard unsaved changes to Blog preferences?')
    await click(q('[data-confirm-cancel]'))
    expect(q('[data-simple-store-form]')?.getAttribute('data-simple-store-form')).toBe('st_preferences')
    expect(rows()).toHaveLength(2)
    await click(store('st_cart'))
    await click(q('[data-confirm-ok]'))
    expect(q('[data-simple-store-form]')?.getAttribute('data-simple-store-form')).toBe('st_cart')
    expect(calls(actions, 'state_update')).toEqual([])
  })

  it('asks before the screen is left for another with edits', async () => {
    mockActions({ ...baseHandlers(), env_status: () => ({ variables: [] }), ...stateModule() })
    const { router } = await mountWithApp(App, OPEN)
    await addField('search', 'Text')
    const moved = router.push('/data/advanced')
    await settle()
    expect(confirmText()).toContain('Discard unsaved changes to Blog preferences?')
    await click(q('[data-confirm-cancel]'))
    await moved
    expect(router.currentRoute.value.path).toBe('/data')
    expect(rows()).toHaveLength(2)
    void router.push('/data/advanced')
    await settle()
    await click(q('[data-confirm-ok]'))
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/data/advanced'))
  })
})

describe('renaming and deleting a store', () => {
  it('renames it with state_rename', async () => {
    const { actions } = await mounted({}, '/data?item=state:st_preferences')
    await click(q('[data-simple-rename]'))
    await typeInto(inputOf('[data-artifact-dialog="rename"] [data-artifact-name]'), 'settings')
    await click(q('[data-artifact-submit]'))
    expect(calls(actions, 'state_rename')).toEqual([{ state: 'st_preferences', name: 'settings' }])
    expect(stored().name).toBe('settings')
  })

  it('refuses to delete one a page uses, and lists the places', async () => {
    const { actions } = await mounted({}, '/data?item=state:st_preferences')
    await click(q('[data-simple-delete]'))
    expect(q('[data-artifact-dialog="delete"]')).not.toBeNull()
    expect(text(q('[data-artifact-uses]'))).toContain('Used in')
    expect(q('[data-artifact-uses] [data-use-open="page:pg_index"]')).not.toBeNull()
    expect(q('[data-artifact-submit]')?.hasAttribute('disabled')).toBe(true)
    await click(q('[data-artifact-submit]'))
    expect(calls(actions, 'state_delete')).toEqual([])
    expect(world.model.modules.blog!.state.map(entry => entry.id)).toContain('st_preferences')
  })

  it('deletes one nothing uses with state_delete, and shows what is left', async () => {
    addStore()
    const { actions } = await mounted({}, '/data?item=state:st_cart')
    await click(q('[data-simple-delete]'))
    expect(q('[data-artifact-uses]')).toBeNull()
    await click(q('[data-artifact-submit]'))
    expect(calls(actions, 'state_delete')).toEqual([{ state: 'st_cart' }])
    expect(store('st_cart')).toBeNull()
    expect(q('[data-simple-store-form]')).toBeNull()
    expect(store('st_preferences')).not.toBeNull()
  })
})

describe('moving between the simple section and the workspace', () => {
  it('has an Advanced switch that opens the workspace on its own route, on the store shown', async () => {
    const { router } = await mounted({}, '/data?item=state:st_preferences')
    await click(q('[data-testid="simple-to-advanced"]'))
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/data/advanced'))
    expect(router.currentRoute.value.query).toEqual({ item: 'state:st_preferences' })
  })

  it('sends an old Data link followed while the section is open to the workspace, with its query', async () => {
    const { router } = await mounted()
    await router.push('/data?item=collection:ent_post&tab=fields')
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/data/advanced'))
    expect(router.currentRoute.value.query).toEqual({ item: 'collection:ent_post', tab: 'fields' })
  })

  it('opens the workspace with nothing chosen when no store is', async () => {
    const { router } = await mounted()
    await click(q('[data-testid="simple-to-advanced"]'))
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/data/advanced'))
    expect(router.currentRoute.value.query).toEqual({})
  })

  it('keeps the menu\'s one Data entry on both screens, and the workspace has a Simple link back', async () => {
    const actions = mockActions({ ...baseHandlers(), env_status: () => ({ variables: [] }), ...stateModule() })
    const { router } = await mountWithApp(DataView, '/data/advanced')
    expect(actions.named('model_get').length).toBeGreaterThan(0)
    expect(text(q('[data-view-menu]'))).toBe('Data')
    expect(q('[data-testid="data"]')).not.toBeNull()
    await click(q('[data-testid="advanced-to-simple"]'))
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/data'))
    expect(router.currentRoute.value.name).toBe('data')
  })

  it('shows a model with problems as the list of them, and links to All model files in the workspace', async () => {
    const { router } = await mounted({ model_get: () => ({ ok: false, problems: [{ path: '.bildr/modules/blog/entities/post.json', message: 'bad entity' }], files: {}, database: false }) })
    // In the section's words: no entity.
    expect(q('[data-testid="data-problems"]')?.textContent).toContain('bad data')
    expect(q('[data-simple-list]')).toBeNull()
    await click(q('[data-testid="open-model"]'))
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/data/advanced'))
    expect(router.currentRoute.value.query).toEqual({ item: 'files' })
  })

  it('has a button labelled Advanced, with its own hook', async () => {
    await mounted()
    // It is a link (it has a route), so it is found by its hook, and its label is read from it.
    const advanced = q('[data-testid="simple-to-advanced"]')
    expect(advanced).not.toBeNull()
    expect(text(advanced)).toBe('Advanced')
    expect(advanced?.getAttribute('href')).toContain('/data/advanced')
  })

  it('keeps the hash of the link it sends to the workspace', async () => {
    const { router } = await mounted()
    await router.push('/data?item=query:q_all_posts#top')
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/data/advanced'))
    expect(router.currentRoute.value.query).toEqual({ item: 'query:q_all_posts' })
    expect(router.currentRoute.value.hash).toBe('#top')
  })

  it('opens the whole app on /data?item=state:<id>: the simple section, on that store', async () => {
    addStore()
    mockActions({ ...baseHandlers(), env_status: () => ({ variables: [] }), ...stateModule() })
    const { router } = await mountWithApp(App, '/data?item=state:st_cart')
    expect(router.currentRoute.value.path).toBe('/data')
    expect(q('[data-testid="simple-data"]')).not.toBeNull()
    expect(q('[data-testid="data"]')).toBeNull()
    expect(q('[data-simple-store-form]')?.getAttribute('data-simple-store-form')).toBe('st_cart')
    expect(router.currentRoute.value.query).toEqual({ item: 'state:st_cart' })
  })
})

describe('an item only the workspace has, asked for in the simple section', () => {
  /** A screen that only hands over, over an editor that only holds what a choice sets (what `openItem` sets). */
  const handoff = async (editor: Record<string, unknown>) => {
    const state = reactive({ dataMigrations: false, dataFiles: false, dataFile: null, collectionId: null, connectionId: null, queryId: null, actionId: null, dataItem: null, dataTab: 'rows', ...editor })
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/data')
    await router.isReady()
    const wrapper = mount(defineComponent({ setup() {
      useAdvancedHandoff(state as never)
      return () => null
    } }), { global: { plugins: [router] } })
    return { state, router, wrapper }
  }

  it('opens the workspace on it, with its tab, when it is chosen', async () => {
    const { state, router, wrapper } = await handoff({})
    expect(router.currentRoute.value.path).toBe('/data')
    Object.assign(state, { actionId: 'act_create_post', dataItem: { kind: 'action', id: 'act_create_post' }, dataTab: 'overview' })
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/data/advanced'))
    expect(router.currentRoute.value.query).toEqual({ item: 'action:act_create_post', tab: 'overview' })
    wrapper.unmount()
  })

  it('opens All model files and the migration the same way', async () => {
    const files = await handoff({})
    Object.assign(files.state, { dataFiles: true, dataFile: '.bildr/project.json' })
    await vi.waitFor(() => expect(files.router.currentRoute.value.path).toBe('/data/advanced'))
    expect(files.router.currentRoute.value.query).toEqual({ item: 'files', file: '.bildr/project.json' })
    files.wrapper.unmount()
    const plan = await handoff({})
    plan.state.dataMigrations = true
    await vi.waitFor(() => expect(plan.router.currentRoute.value.query).toEqual({ item: 'migrations' }))
    plan.wrapper.unmount()
  })

  it('does nothing while nothing is asked for', async () => {
    const { router, wrapper } = await handoff({})
    await settle()
    expect(router.currentRoute.value.path).toBe('/data')
    wrapper.unmount()
  })
})
